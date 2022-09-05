const express = require('express');
const app = express();
const {Client} = require('@elastic/elasticsearch');
const client = new Client({node: 'http://localhost:9200'});
const path = require('path');

app.set('view engine', 'pug');
app.set('views', './views');

const {Index: INDEXNAME, Properties: properties} = require('../jurisprudencia');
const filterableProps = Object.entries(properties).filter(([_, obj]) => obj.type == 'keyword' || obj.fielddata).map( ([name, _]) => name).filter( o => o != "URL" && o != "UUID").concat("Votação")
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
    aggs[name] = {
        terms: {
            field: name,
            size: 65536,
            order: {
                _term: "asc"
            }
        }
    }
});
aggs["Descritores"] = {
    terms: {
        field: "Descritores.keyword",
        size: 65536,
        order: {
            _term: "asc"
        }
    }
}
aggs["Votação"] = {
    terms: {
        field: "Votação.Forma",
        size: 65536,
        order: {
            _term: "asc"
        }
    }
}
aggs["Meio Processual"] = {
    terms: {
        field: "Meio Processual.keyword",
        size: 65536,
        order: {
            _term: "asc"
        }
    }
}

aggs["Tipo de Processo"] = aggs["Tipo"];
delete aggs["Tipo"];
aggs["Número de Processo"] = aggs["Processo"];
delete aggs["Processo"];
filterableProps[filterableProps.indexOf("Tipo")] = "Tipo de Processo";
filterableProps[filterableProps.indexOf("Processo")] = "Número de Processo";

const DEFAULT_AGGS = {
    MaxAno : aggs.MaxAno,
    MinAno : aggs.MinAno
};

const RESULTS_PER_PAGE = 50;

let queryObject = (string) => {
    if( !string ){
        return {
            match_all: {}
        };
    }
    return [{
        simple_query_string: {
            query: Array.isArray(string) ? string.join(" ") : string
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
    index: "jurisprudencia.5.0",
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

const tmp = app.render.bind(app);
app.render = async (name, obj, next) => {
    let aggsGlobal = await allSearchAggPromise;
    tmp(name, { aggsGlobal, properties: filterableProps, requestStart: new Date(), ...obj, DATA_FIELD }, next);
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
            searchedArray: await searchedArray(req.query.q)
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
            max_score: results.hits.max_score
        });
    }).catch(e => {
        console.log(e);
        res.render("acord-article", {
            hits: [],
            max_score: 0,
        });
    });
});

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
});

function listAggregation(term){
    return {
        MinAno: aggs.MinAno,
        MaxAno: aggs.MaxAno,
        [term]: {
            terms: {
                field: aggs[term].terms.field,  
                size: 65536/5,
                order: {
                    _term: "asc",
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
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if( fields.indexOf(term) == -1 ){
        res.write(`"Erro"\n`);
        res.write(`O campo "${term}" não foi indexado.\n`);
        return res.end();
    }
    const sfilters = {pre: [], after: []};
    const filters = populateFilters(sfilters, req.query, []);
    res.write(`"${term}","Quantidade Total","Primeira Data","Última Data"\n`);
    search(queryObject(req.query.q), sfilters, 0, listAggregation(term), 0).then( body => {
        body.aggregations[term].buckets.forEach( bucket => {
            res.write(`"${bucket.key}",${bucket.doc_count},"${bucket.MinAno.value_as_string}","${bucket.MaxAno.value_as_string}"\n`);
        });
        res.end();
    }).catch( err => {
        console.log(req.originalUrl, err)
        res.write(`"Erro"\n`);
        res.write(`"${err.message}"\n`)
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
                        "interval": "year",
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
        return res.json()
    }
    const sfilters = {pre: [], after: []};
    const filters = populateFilters(sfilters, req.query, []);
    search(queryObject(req.query.q), sfilters, 0, histogramAggregation(term, value), 0).then( body => {
        res.json(body.aggregations);
    }).catch( err => {
        res.json()
    })

})

app.get("/related-:proc(*)", (req, res) => {
    let proc = req.params.proc;
    search({term: {UUID: proc}}, {pre:[], after:[]}, 0, {}, 1, {_source: ['Processo']}).then(async (body) => {
        if( body.hits.total.value == 0 ) return [];
        let processo = body.hits.hits[0]._source["Processo"];
        let rs = [];
        while( true ){
            let cr = await search({wildcard: {Processo: `${processo}*`}}, {pre:[], after:[]}, 0, {}, 100, {_source: ['Processo', "UUID", DATA_FIELD]});
            cr.hits.hits.forEach( hit => {
                if( hit._source.UUID == proc || rs.find(o => o.UUID == hit._source.UUID) ) return;
                rs.push({
                    Processo: hit._source.Processo,
                    UUID: hit._source.UUID,
                    Data: hit._source[DATA_FIELD]
                });
            })
            if( Math.max(processo.lastIndexOf("."), processo.lastIndexOf("-")) == -1 ) break;
            processo = processo.slice(0,Math.max(processo.lastIndexOf("."), processo.lastIndexOf("-")))
        }
        return rs;
    }).then( l => res.json(l))
})

app.get("/acord-:proc(*)", (req, res) => {
    let proc = req.params.proc;
    search({term: {UUID: proc}}, {pre:[], after:[]}, 0, {}, 100, {_source: ['*'], fields: [DATA_FIELD]}).then((body) => {
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
                for( let i = 0; i < body.hits.hits.length; i++ ){
                    html += `<li><a href=?docnum=${i}>Abrir documento ${i}</a></li>`
                }
                res.render("document", {proc, error: `<ul><p>More than one document found.</p>${html}</ul>`});
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

let spawn = require('child_process').spawn;
function sendDocxOfHtml(res, html, name){
    let docx = spawn("pandoc", ["-f", "html", "-t", "docx", "-o", "-"]);
    docx.stdin.write(html);
    docx.stdin.end();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename=${name}.docx`);
    docx.stdout.pipe(res);
}

app.get("/docx/acord-:proc(*)", (req, res) => {
    let proc = req.params.proc;
    search({term: {UUID: proc}}, {pre:[], after:[]}, 0, {}, 100, {_source: ['Texto'], fields: []}).then((body) => {
        if( body.hits.total.value == 0 ){
            res.render("document", {proc});
        }
        else if( body.hits.total.value == 1 ) {
            sendDocxOfHtml(res, body.hits.hits[0]._source["Texto"], proc);
        }
        else{
            let docnum = req.query.docnum;
            if( !docnum ){
                let html = ''
                for( let i = 0; i < body.hits.hits.length; i++ ){
                    html += `<li><a href=?docnum=${i}>Abrir documento ${i}</a></li>`
                }
                res.render("document", {proc, error: `<ul><p>More than one document found.</p>${html}</ul>`});
            }
            else{
                sendDocxOfHtml(res, body.hits.hits[docnum]._source["Texto"], proc);
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
    if( aggKey == "Datafield" ){
        client.indices.getMapping({index: INDEXNAME}).then(body => {
            res.render("datalist", {aggs: Object.entries(body[INDEXNAME].mappings.properties).filter(o => o[1].fielddata || o[1].type == "keyword").map(o => ({key: o[0]})), id: id});
        });
        return;
    }
    if( !agg ) {
        res.render("datalist", {aggs: [], error: "Aggregation not found", id: req.query.id});
        return;
    }
    let finalAgg = {
        terms: {
            field: agg.terms.field,
            size: agg.terms.size
        }
    }
    const sfilters = {pre: [], after: []};
    populateFilters(sfilters, req.query, [aggKey]);
    search(queryObject(req.query.q), sfilters, 0, { [aggKey]: finalAgg}, 10).then(async body => {
        if( body.aggregations[aggKey].buckets.length < 10 ){
            body = await search(queryObject(req.query.q), sfilters, 0, { [aggKey]: agg }, 0);
        }
        res.render("datalist", {aggs: body.aggregations[aggKey].buckets, id: id});
    }).catch(err => {
        console.log(req.originalUrl, err.body.error);
        res.render("datalist", {aggs: [], error: err, id: id});
    });
});

app.use('/csm-errados', (req, res) => {
    res.render("csm-errados");
});

app.use('/procurar-seccoes', (req, res) => {
    res.render("procurar-seccoes");
});

app.use('/test-anonimizador', (_, res) => res.render("anonimizador"));
app.use('/test-sumarizador', (_, res) => res.render("sumarizador"));

app.use('/tabelas', require('./tables'));
app.use('/tinymce', express.static(path.join(require.resolve('tinymce'),'..')));
app.use('/stats-sse', require('./csm-errados'));
app.use('/seccoes-sse', require('./procurar-seccoes'));
app.use(express.static(path.join(__dirname, "static")));

app.listen(parseInt(process.env.PORT) || 9100)