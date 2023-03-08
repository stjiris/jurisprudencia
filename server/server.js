const express = require('express');
const app = express();
const {Client} = require('@elastic/elasticsearch');
const client = new Client({node: process.env.ES_URL || 'http://localhost:9200'});
const path = require('path');

app.set('view engine', 'pug');
app.set('views', './views');

const {Index: INDEXNAME, Properties: properties} = require('../jurisprudencia');
const saveSearch = require('./save-search');
const filterableProps = Object.entries(properties).filter(([_, obj]) => obj.type == 'keyword' || (obj.fields && obj.fields.keyword)).map( ([name, _]) => name).filter( o => o != "URL" && o != "UUID")
let DATA_FIELD = "Data";
const aggs = {
    MinAno: {
        min: {
            field: DATA_FIELD,
            format: 'yyyy'
        }
    },
    MaxAno: {
        max: {
            field: DATA_FIELD,
            format: 'yyyy'
        }
    }
}
filterableProps.forEach(name => {
    let key = properties[name].fields ? name + ".keyword" : name
    aggs[name] = {
        terms: {
            field: key,
            size: 65536,
            order: {
                _key: "asc"
            }
        }
    }
});

function renameElasticField(newName, oldName){
    aggs[newName] = aggs[oldName];
    delete aggs[oldName];
    filterableProps[filterableProps.indexOf(oldName)] = newName;
}

function dropElasticField(name){
    filterableProps.splice(filterableProps.indexOf(name),1)
    delete aggs[name];
}

renameElasticField("Relator", "Relator Nome Profissional")
renameElasticField("Número de Processo", "Processo")
dropElasticField("Relator Nome Completo")
dropElasticField("Tipo")

const DEFAULT_AGGS = {
    MaxAno : aggs.MaxAno,
    MinAno : aggs.MinAno
};

const RESULTS_PER_PAGE = 10;

let queryObject = (string) => {
    if( !string ){
        return {
            match_all: {}
        };
    }
    return [{
        simple_query_string: {
            query: Array.isArray(string) ? string.join(" ") : string,
            fields: ["*"],
            default_operator: 'OR'
        }
    }];
}

let search = (
    query, // query string, ideally given by queryObject()
    filters={pre: [], after: []}, // filters to be applied, pre for before the query, after for after the query (affects aggregations)
    page=0, // page number [0, ...]
    saggs=DEFAULT_AGGS, // aggregations to be applied
    rpp=RESULTS_PER_PAGE, // results per page
    extras={}  // extra fields to aply to the search if needed
) => client.search({
    index: INDEXNAME,
    query: {
        bool: {
            must: query,
            filter: filters.pre
        }
    },
    post_filter: { // Filter after aggregations
        bool: {
            filter: filters.after
        }
    },
    aggs: saggs,
    size: rpp,
    from: page*rpp,
    track_total_hits: true,
    _source: filterableProps.concat("Sumário"),
    fields: [DATA_FIELD],
    ...extras
});

const padZero = (num, size=4) => {
    let s = num.toString();
    while( s.length < size ){
        s = "0" + s;
    }
    return s;
}

const populateFilters = (filters, body={}, afters=["MinAno","MaxAno"]) => { // filters={pre: [], after: []}
    const filtersUsed = {}
    for( let key in aggs ){
        let aggName = key;
        let aggObj = aggs[key];
        let aggField = aggObj.terms ? "terms" : "significant_terms";
        if( !aggObj[aggField] ) continue;
        if( body[aggName] ){
            filtersUsed[aggName] = (Array.isArray(body[aggName]) ? body[aggName] : [body[aggName]]).filter(o => o.length > 0);
            let when = "pre";
            if( afters.indexOf(aggName) != -1 ){
                when = "after";
            }
            filters[when].push({
                bool: {
                    should: filtersUsed[aggName].map( o => (o.startsWith("\"") && o.endsWith("\"") ? {
                        term: {
                            [aggObj[aggField].field]: { value: `${o.slice(1,-1)}` }
                        }
                    } : {
                        wildcard: {
                            [aggObj[aggField].field]: { value: `*${o}*` }
                        }
                    }))
                }
            });
        }
    }

    let dateWhen = "pre";
    if( afters.indexOf("MinAno") >= 0 || afters.indexOf("MaxAno") >= 0 ) dateWhen = "after";
    if( body.MinAno && body.MaxAno ){

        filtersUsed.MinAno = body.MinAno;
        filtersUsed.MaxAno = body.MaxAno;
        filters[dateWhen].push({
            range: {
                [DATA_FIELD]: {
                    gte: padZero(body.MinAno),
                    lt: padZero((parseInt(body.MaxAno) || new Date().getFullYear())+1),
                    format: "yyyy"
                }
            }
        });
    }
    else if( body.MinAno ){
        filtersUsed.MinAno = body.MinAno;
        filters[dateWhen].push({
            range: {
                [DATA_FIELD]: {
                    gte: padZero(body.MinAno),
                    format: "yyyy"
                }
            }
        });
    }
    else if( body.MaxAno ){
        filtersUsed.MaxAno = body.MaxAno;
        filters[dateWhen].push({
            range: {
                [DATA_FIELD]: {
                    lt: padZero((parseInt(body.MaxAno) || new Date().getFullYear())+1),
                    format: "yyyy"
                }
            }
        });
    }
    if( body.notHasField ){
        filtersUsed.notHasField = (Array.isArray(body.notHasField) ? body.notHasField : [body.notHasField]).filter(o => o.length> 0);
        filtersUsed.notHasField.forEach(field => {
            filters.pre.push({
                bool: {
                    must_not: {
                        exists: {
                            field: field
                        }
                    }
                }
            });
        });
    }
    if( body.hasField ){
        filtersUsed.hasField = (Array.isArray(body.hasField) ? body.hasField : [body.hasField]).filter(o => o.length> 0);
        filtersUsed.hasField.forEach(field => {
            filters.pre.push({
                bool: {
                    must: {
                        exists: {
                            field: field
                        }
                    },
                    must_not: {
                        term: {
                            [field]: ""
                        }
                    }
                }
            });
        });
    }
    return filtersUsed;
}

function queryString(originalUrl, drop=["page", "sort"]){
    let url = new URL(originalUrl, "a://b");
    let query = new URLSearchParams(url.searchParams);
    for( let k of drop ){
        query.delete(k);
    }
    return query.toString();
}

function parseSort(value, array){
    const sortV = value || "score";
    if( sortV == "des" ){
        array.push({
            [DATA_FIELD]: "desc"
        });
    }
    else if( sortV == "asc" ){
        array.push({
            [DATA_FIELD]: "asc"
        });
    }
    else if( sortV == "score" ){
        array.push({
            _score: "desc"
        });
        array.push({
            [DATA_FIELD]: "desc"
        })
    }
    return sortV;
}

let searchedArray = (string) => client.indices.analyze({
    index: INDEXNAME,
    text: string
}).then( r => r.tokens.map( o => o.token) ).catch( e => [])

let allSearchAggPromise = search(queryObject(""), {pre:[],after:[]}, 0, DEFAULT_AGGS, 0).catch( e => {
    console.log("Server couldn't reach elastic search. Using assumed values.")
    return {
        aggregations: {
            MinAno: {
                value_as_string: "1931"
            },
            MaxAno: {
                value_as_string: new Date().getFullYear().toString()
            }
        }
    }
}).then( r => r.aggregations )

function shouldCapitalize(word){
    let exceptions = ["e","o","a","os","as","de","da","do","das","dos","à","no","na","nos","nas","em","por","com","ao","aos"]
    return exceptions.indexOf(word.toLowerCase()) == -1
}

function titleCase(str){
    return str.replace(/\S+/g, (v) => {
        if( shouldCapitalize(v) ){
            return v[0].toUpperCase() + v.substr(1).toLowerCase();
        }
        return v.toLocaleLowerCase()
    })
}

const tmp = app.render.bind(app);
app.render = async (name, obj, next) => {
    let aggsGlobal = await allSearchAggPromise;
    tmp(name, { aggsGlobal, titleCase, properties: filterableProps, requestStart: new Date(), ...obj, DATA_FIELD }, next);
}

// Returns page with filters
app.get("/", (req, res) => {
    const sfilters = {pre: [], after: []};
    const filtersUsed = populateFilters(sfilters, req.query);
    let sort = [];
    let sortV = parseSort(req.query.sort, sort);
    let sortE = true;
    if( !req.query.q && !req.query.sort && Object.keys(filtersUsed).length == 0 ){
        sort = [];
        sortV = parseSort("des", sort);
        sortE = false;
    }
    let page = parseInt(req.query.page) || 0;
    let searchId = saveSearch(queryString(req.originalUrl, [])).catch(e =>{
        console.log(e);
        return ""
    });
    search(queryObject(req.query.q), sfilters, page, DEFAULT_AGGS, 0, { sort }).then(async results => {
        res.render("search", {
            q: req.query.q, querystring: queryString(req.originalUrl),
            sort: sortV,
            sortEnabled: sortE,
            body: results,
            hits: results.hits.hits,
            aggs: results.aggregations,
            filters: filtersUsed,
            page: page,
            pages: Math.ceil(results.hits.total.value/RESULTS_PER_PAGE),
            open: Object.keys(filtersUsed).length > 0,
            searchedArray: await searchedArray(req.query.q),
            searchId: await searchId
        });
    }).catch(async e => {
        console.log(e);
        res.render("search", {
            q: req.query.q, querystring: queryString(req.originalUrl),
            sort: sortV,
            sortEnabled: sortE,
            body: {},
            hits: [],
            aggs: {},
            filters: {},
            page: page,
            pages: 0,
            open: true,
            error: e,
            searchId: await searchId,
            searchedArray: await searchedArray(req.query.q)
        });
    })
})

// returns only acordãos
app.get("/acord-only", (req, res) => {
    const sfilters = {pre: [], after: []};
    populateFilters(sfilters, req.query);
    const sort = [];
    parseSort(req.query.sort, sort);
    let page = parseInt(req.query.page) || 0;
    let highlight = {
        fields: {
            "Descritores": {
                type: "unified",
                highlight_query: {
                    bool: {
                        must: queryObject(req.query.q)
                    }
                },
                pre_tags: [""],
                post_tags: [""],
                number_of_fragments: 0           
            },
            "Sumário": {
                type: "fvh",
                highlight_query: {
                    bool: {
                        must: queryObject(req.query.q)
                    }
                },
                number_of_fragments: 0,
                pre_tags: ["<mark>"],
                post_tags: ["</mark>"]
            },
            "Texto": { 
                type: "fvh",
                highlight_query: {
                    bool: {
                        must: queryObject(req.query.q)
                    }
                },
                number_of_fragments: 1000,
                pre_tags: ["MARK_START"],
                post_tags: ["MARK_END"]
            }
        },
        max_analyzed_offset: 1000000
    };
    let searchId = saveSearch(queryString(req.originalUrl, [])).catch(e =>{
        console.log(e);
        return ""
    });
    search(queryObject(req.query.q), sfilters, page, {}, RESULTS_PER_PAGE, { sort, highlight, track_scores: true, _source:  [...Object.keys(properties), "Sumário", "Texto"] }).then( async results => {
        searchArray = await searchedArray(req.query.q)
        let colorFromText = (txt) => `var(--highlight-${searchArray.indexOf(txt.toLocaleLowerCase().trim())}, var(--primary-gold))`;
        results.hits.hits.map( hit => {
            if( !hit.highlight ) return
            if( hit.highlight.Texto ){
                for(let i = 0; i < hit.highlight.Texto.length; i++){
                    let text = hit.highlight.Texto[i];
                    let mat = text.match(/MARK_START(?<mat>.*?)MARK_END/).groups?.mat || "";
                    hit.highlight.Texto[i] = {
                        text: text.replace(/<[^>]+>/g, "").replace(/MARK_START/g, "<mark>").replace(/MARK_END/g, "</mark>").replace(/<\/?\w*$/, ""),
                        offset: hit._source.Texto.indexOf(text.substring(0, text.indexOf("MARK_START"))),
                        size: hit._source.Texto.length,
                        color: colorFromText(mat)
                    }
                }
                delete hit._source.Texto;
            }
            if( hit.highlight.Sumário ){
                let it = hit.highlight.Sumário[0].matchAll(/[^>]{0,100}<mark>(?<mat>\w+)<\/mark>[^<]{0,100}/g)
                hit.highlight.SumárioMarks = [];
                for( let m of it ){
                    let mat = m.groups?.mat || "";
                    hit.highlight.SumárioMarks.push({
                        text: m[0],
                        offset: m.index,
                        size: hit._source.Sumário.length,
                        color: colorFromText(mat)
                    });
                }
            }
        })
        res.render("acord-article", {
            hits: results.hits.hits,
            max_score: results.hits.max_score,
            searchId: await searchId
        });
    }).catch(e => {
        console.log(e);
        res.render("acord-article", {
            hits: [],
            max_score: 0,
        });
    });
});

/* TODO: redo statistics
const statsAggs = {
    MinAno: {
        min: {
            field: DATA_FIELD,
            format: "yyyy"
        }
    },
    MaxAno: {
        max: {
            field: DATA_FIELD,
            format: "yyyy"
        }
    },
    Anos: {
        date_histogram: {
            field: DATA_FIELD,
            interval: 'year',
            format: 'yyyy',
            min_doc_count: 0
        }
    },
    Origens: {
        terms: {
            field: 'Origem',
            size: 20
        }
    },
    "Secções": {
        filters: {
            filters: {
                "Com secção": {
                    exists: {
                        field: "Secção"
                    }
                },
                "Sem secção": {
                    bool: {
                        must_not: {
                            exists: {
                                field: "Secção"
                            }
                        }
                    }
                }
            }
        }
    }
}

app.get("/estatisticas", (req, res) => {
    const sfilters = {pre: [], after: []};
    const filters = populateFilters(sfilters, req.query);
    search(queryObject(req.query.q), sfilters, 0, DEFAULT_AGGS, 0, {}).then(body => {
        res.render("stats", {q: req.query.q, querystring: queryString(req.originalUrl), body: body, aggs: body.aggregations, filters: filters, open: Object.keys(filters).length > 0});
    }).catch(e => {
        console.log(e);
        res.render("stats", {q: req.query.q, querystring: queryString(req.originalUrl), body: {}, aggs: {}, filters: {}, open: true, error: e});
    });
});

app.get("/allStats", (req, res) => {
    const sfilters = {pre: [], after: []};
    populateFilters(sfilters, req.query, []);
    search(queryObject(req.query.q), sfilters, 0, statsAggs, 0 ).then(body => {
        res.json(body.aggregations);
    }).catch(err => {
        console.log(req.originalUrl, JSON.stringify(err.body))
        res.json({});
    });
});*/

function listAggregation(term){
    return {
        MinAno: aggs.MinAno,
        MaxAno: aggs.MaxAno,
        [term]: {
            terms: {
                field: aggs[term].terms.field.replace("keyword","raw"),
                size: 65536/5,
                order: {
                    _key: "asc",
                }
            },
            aggs: {
                MinAno: {
                    min: {
                        field: DATA_FIELD
                    }
                },
                MaxAno: {
                    max: {
                        field: DATA_FIELD
                    }
                },
                Secções: {
                    terms: {
                        field: "Secção.raw",
                        size: 9
                    }
                }
            }
        }
    }
}

app.get("/indices", (req, res) => {
    const term = req.query.term || "Relator";
    const fields = filterableProps;
    if( fields.indexOf(term) == -1 ){
        return res.render("list", {q: req.query.q, querystring: queryString(req.originalUrl), body: {}, error: `O campo "${term}" não foi indexado.`, aggs: {}, letters: {}, filters: {}, term: term, fields: fields})
    }
    const sfilters = {pre: [], after: []};
    const filters = populateFilters(sfilters, req.query, []);

    search(queryObject(req.query.q), sfilters, 0, listAggregation(term), 0).then( body => {
        res.render("list", {q: req.query.q, querystring: queryString(req.originalUrl), body: body, aggs: body.aggregations, filters: filters, term: term, open: Object.keys(filters).length > 0, fields: fields});
    }).catch( err => {
        console.log(req.originalUrl, err)
        res.render("list", {q: req.query.q, querystring: queryString(req.originalUrl), body: {}, error: err, aggs: {}, letters: {}, filters: {}, term: term, fields: fields});
    });
});

app.get("/indices.csv", (req, res) => {
    const term = req.query.term || "Relator";
    const fields = filterableProps;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    if( fields.indexOf(term) == -1 ){
        res.write(`"Erro"\r\n`);
        res.write(`O campo "${term}" não foi indexado.\r\n`);
        return res.end();
    }
    const sfilters = {pre: [], after: []};
    const filters = populateFilters(sfilters, req.query, []);
    let secs = ["1.ª Secção (Cível)","2.ª Secção (Cível)","3.ª Secção (Criminal)","4.ª Secção (Social)","5.ª Secção (Criminal)","6.ª Secção (Cível)","7.ª Secção (Cível)","Secção Contencioso"]
    res.write(`"${term}","Quantidade Total","Primeira Data","Última Data",${secs.map( s => `"${s}"`).join(',')}\r\n`)
    search(queryObject(req.query.q), sfilters, 0, listAggregation(term), 0).then( body => {
        let getSecCount = (bucks, key) => bucks.find( o => o.key == key )?.doc_count || 0;
        body.aggregations[term].buckets.forEach( bucket => {
            res.write(`"${bucket.key}",${bucket.doc_count},"${bucket.MinAno.value_as_string}","${bucket.MaxAno.value_as_string}",${secs.map(n => getSecCount(bucket.Secções.buckets, n)).join(',')}\r\n`);
        });
        res.end();
    }).catch( err => {
        console.log(req.originalUrl, err)
        res.write(`"Erro"\r\n`);
        res.write(`"${err.message}"\r\n`)
        res.end();
    });
})

function histogramAggregation(key, value){
    return {
        MinAno: aggs.MinAno,
        MaxAno: aggs.MaxAno,
        Term: {
            filter: {
                term: {
                    [aggs[key].terms.field]: value
                }
            },
            aggs: {
                MinAno: aggs.MinAno,
                MaxAno: aggs.MaxAno,
                Anos: {
                    date_histogram: {
                        "field": DATA_FIELD,
                        "calendar_interval": "year",
                        "format": "yyyy"
                    }
                }
            }
        }
    }
}

app.get("/histogram", (req, res) => {
    const term = req.query.term || "Relator";
    const value = req.query.histogram_value;
    const fields = filterableProps;
    if( fields.indexOf(term) == -1 ){
        return res.status(400).json()
    }
    const sfilters = {pre: [], after: []};
    const filters = populateFilters(sfilters, req.query, []);
    search(queryObject(req.query.q), sfilters, 0, histogramAggregation(term, value), 0).then( body => {
        res.json(body.aggregations);
    }).catch( err => {
        console.log(req.originalUrl, err)
        res.status(500).json(err)
    })

})

app.get("/related/:proc/:partialuuid/", (req, res) => {
    let proc = req.params.proc;
    let puuid = req.params.partialuuid;
    let m = proc.match(/(?<base>[^/]+\/\w+\.\w+(-\w+)?)\./); 
    if( !m ){
        return [];
    }
    search({wildcard: {Processo: `${m.groups.base}*`}}, {pre:[], after:[]}, 0, {}, 100, {_source: ['Processo', "UUID", DATA_FIELD]}).then( related => {
        return related.hits.hits.map( hit => ({
            Processo: hit._source.Processo,
            UUID: hit._source.UUID,
            Data: hit._source[DATA_FIELD]
        })).filter( hit => hit.UUID.indexOf(puuid) != 0);
    }).then( l => res.json(l))
})

app.get("/p/:proc?/:partialuuid?/", (req, res, next) => {
    if( req.query.search ){
        saveSearch.trackClickedDocument(req.query.search, req.params.proc).catch(e => {
            console.log(e);
        });
    }

    let must = [];
    let proc = req.params.proc;
    if(proc){
        must.push({term: {Processo: proc}})
    }
    let puuid = req.params.partialuuid;
    if( puuid ){
        must.push({wildcard: {UUID: `${puuid}*`}})
    }
    if( must.length == 0 ){
        return next();
    }

    search({bool: {must}}, {pre:[], after:[]}, 0, {}, 100, {_source: ['*'], fields: [DATA_FIELD]}).then((body) => {
        if( body.hits.total.value == 0 ){
            res.render("document", {proc});
        }
        else if( body.hits.total.value == 1 ) {
            res.render("document", {proc, source: body.hits.hits[0]._source, fields: body.hits.hits[0].fields, aggs});
        }
        else{
            let docnum = req.query.docnum;
            if( !docnum ){
                let html = ''
                let i=1;
                for( let hit of body.hits.hits ){
                    html += `<li><a href=./p/${encodeURIComponent(hit._source.Processo)}/${hit._source.UUID.substr(0,6)}/>Abrir documento ${i++}</a></li>`
                }
                res.render("document", {proc, error: `<ul><p>Encontrados multiplos documentos.</p>${html}</ul>`});
            }
            else{
                res.render("document", {proc, source: body.hits.hits[docnum]._source, fields: body.hits.hits[docnum].fields, aggs});
            }
        }
    }).catch(err => {
        console.log(req.originalUrl, err);
        res.render("document", {proc, error: err});
    });
});

app.get("/datalist", (req, res) => {
    let aggKey = req.query.agg;
    let agg = aggs[aggKey];
    let id = req.query.id || "";
    if( aggKey == "Campos" ){
        client.indices.getMapping({index: INDEXNAME}).then(body => {
            res.render("datalist", {aggs: Object.keys(body[INDEXNAME].mappings.properties).map(o => ({key: o})), id: id});
        });
        return;
    }
    if( !agg ) {
        res.render("datalist", {aggs: [], error: "Aggregation not found", id: req.query.id});
        return;
    }
    let finalAgg = {
        terms: {
            field: agg.terms.field.replace("keyword","raw"),
            size: agg.terms.size
        }
    }
    const sfilters = {pre: [], after: []};
    populateFilters(sfilters, req.query, [aggKey]);
    search(queryObject(req.query.q), sfilters, 0, { [aggKey]: finalAgg}, 10).then(body => {
        res.render("datalist", {aggs: body.aggregations[aggKey].buckets, id: id});
    }).catch(err => {
        console.log(req.originalUrl, err.body.error);
        res.render("datalist", {aggs: [], error: err, id: id});
    });
});

app.get("/go/:searchId", async(req, res) => {
    let params = await saveSearch.getShearchParams(req.params.searchId);
    res.redirect(`../?${params}`);
})

app.use(express.static(path.join(__dirname, "static"), {extensions: ["html"]}));
app.listen(parseInt(process.env.PORT) || 9100)