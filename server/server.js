const express = require('express');
const app = express();
const {Client} = require('@elastic/elasticsearch');
const client = new Client({node: 'http://localhost:9200'});
const path = require('path');

app.set('view engine', 'pug');
app.set('views', './views');

const {mappings: {properties}} = require('../elastic-index-mapping.json');
const INDEXNAME = process.env.INDEX || "jurisprudencia.2.0"

const aggs = {}
let DATA_FIELD = "";
const DEFAULT_AGGS = {};
const runtimeMapping = {};

client.indices.getMapping({index: INDEXNAME}).then( obj => {
    let props = obj[INDEXNAME].mappings.properties;
    Object.entries(props).filter(([name, obj])=>obj.type == 'keyword').map(([name, _])=> name).forEach(name => {
        aggs[name] = {
            terms: {
                field: name,
                size: 65536,
                order: {
                    _term: "asc"
                }
            }
        }
    })
    DATA_FIELD = Object.entries(props).filter(([name, obj]) => obj.type == 'date' && obj.copy_to)[0][1].copy_to[0] 
    
    aggs["MinAno"] = {
        min: {
            field: DATA_FIELD,
            format: 'yyyy'
        }
    };
    aggs["MaxAno"] = {
        max: {
            field: DATA_FIELD,
            format: 'yyyy'
        }
    };
    aggs["Descritores"] = {
        terms: {
            field: "Descritores.keyword",
            size: 65536,
            order: {
                _term: "asc"
            }
        }
    }
    aggs["Tribunal"].terms.min_doc_count = 0;
    aggs["Código Tribunal"].terms.min_doc_count = 0;
    DEFAULT_AGGS.Tribunal = {...aggs.Tribunal, aggs: {Codigo: {terms: {field: 'Código Tribunal', size: 1}}}}
    DEFAULT_AGGS.MaxAno = aggs.MaxAno
    DEFAULT_AGGS.MinAno = aggs.MinAno

    runtimeMapping.runtime_mappings = {
        LastDate: {
            type: "date",
            format: "yyyy",
            script: `
                def lastDate = doc['${DATA_FIELD}'][0];
                for( item in doc['${DATA_FIELD}'] ){
                    if( item.getMillis() > lastDate.getMillis() ){
                        lastDate = item;
                    }
                }
                emit(lastDate.getMillis());
            `
        }
    };
});

const RESULTS_PER_PAGE = 50;

let queryObject = (string) => {
    if( !string ) return {
        match_all: {}
    };
    return {
        simple_query_string: {
            query: string,
            default_operator: "AND"
        }
    };
}

const tmp = app.render.bind(app);
app.render = (name, obj, next) => {
    tmp(name, { properties, requestStart: new Date(), ...obj, DATA_FIELD }, next);
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
            filter: filters.pre, // Hide documents from aggregations
            must_not: [{
                term: {
                    "Origem": "csm-indexer"
                }
            }]
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
    _source: [...Object.keys(properties), "Sumário"],
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

const populateFilters = (filters, body={}, afters=["Tribunal","MinAno","MaxAno"]) => { // filters={pre: [], after: []}
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
                    should: filtersUsed[aggName].map( o => ({
                        wildcard: {
                            [aggObj[aggField].field]: { value: `*${o}*` }
                        }
                    }))
                }
            });
        }
    }
    if( body.MinAno && body.MaxAno ){
        filtersUsed.MinAno = body.MinAno;
        filtersUsed.MaxAno = body.MaxAno;
        filters.pre.push({
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
        filters.pre.push({
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
        filters.pre.push({
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

// Returns page with filters
app.get("/", (req, res) => {
    const sfilters = {pre: [], after: []};
    const filtersUsed = populateFilters(sfilters, req.query);
    const sort = [];
    const sortV = parseSort(req.query.sort, sort);
    let page = parseInt(req.query.page) || 0;
    search(queryObject(req.query.q), sfilters, page, DEFAULT_AGGS, 0, { sort }).then(results => {
        res.render("search", {
            q: req.query.q, querystring: queryString(req.originalUrl),
            sort: sortV,          
            body: results,
            hits: results.hits.hits,
            aggs: results.aggregations,
            filters: filtersUsed,
            page: page,
            pages: Math.ceil(results.hits.total.value/RESULTS_PER_PAGE),
            open: Object.keys(filtersUsed).length > 0
        });
    }).catch(e => {
        console.log(e);
        res.render("search", {
            q: req.query.q, querystring: queryString(req.originalUrl),
            sort: sortV,
            body: {},
            hits: [],
            aggs: {},
            filters: {},
            page: page,
            pages: 0,
            open: true,
            error: e
        });
    });
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
                        must: [
                            queryObject(req.query.q)
                        ]
                    }
                },
                pre_tags: [""],
                post_tags: [""],
                number_of_fragments: 0           
            },
            "Sumário": {
                type: "unified",
                highlight_query: {
                    bool: {
                        must: [
                            queryObject(req.query.q)
                        ]
                    }
                },
                number_of_fragments: 0,
                pre_tags: ["<mark>"],
                post_tags: ["</mark>"]
            },
            "*Texto*": { 
                type: "unified",
                highlight_query: {
                    bool: {
                        must: [
                            queryObject(req.query.q)
                        ]
                    }
                },
                number_of_fragments: 1000,
                pre_tags: ["MARK_START"],
                post_tags: ["MARK_END"]
            }
        },
        max_analyzed_offset: 1000000
    };
    search(queryObject(req.query.q), sfilters, page, {}, RESULTS_PER_PAGE, { sort, highlight, track_scores: true, _source:  [...Object.keys(properties), "Sumário", "*Texto*"] }).then(results => {
        results.hits.hits.forEach( hit => {
            if( !hit.highlight ) return;
            let highlightedKeys = Object.keys(hit.highlight).filter(k => k.match(/Texto/));
            for( let k of highlightedKeys ){
                for(let i = 0; i < hit.highlight[k].length; i++){
                    let text = hit.highlight[k][i];
                    hit.highlight[k][i] = {
                        text: text.replace(/<[^>]+>/g, "").replace(/MARK_START/g, "<mark>").replace(/MARK_END/g, "</mark>").replace(/<\/?\w*$/, ""),
                        offset: hit._source[k].indexOf(text.substring(0, text.indexOf("MARK_START"))),
                        size: hit._source[k].length
                    }
                }
                delete hit._source[k];
            }
            if( hit.highlight.Sumário ){
                let it = hit.highlight.Sumário[0].matchAll(/[^>]{0,100}<mark>\w+<\/mark>[^<]{0,100}/g)
                hit.highlight.SumárioMarks = [];
                for( let m of it ){
                    hit.highlight.SumárioMarks.push({
                        text: m[0],
                        offset: m.index,
                        size: hit._source.Sumário.length
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
    Tribunal: aggs.Tribunal,
    MinAno: {
        min: {
            field: "LastDate",
            format: "yyyy"
        }
    },
    MaxAno: {
        max: {
            field: "LastDate",
            format: "yyyy"
        }
    },
    Anos: {
        terms: {
            field: 'Tribunal',
            size: 20
        },
        aggs: {
            Anos: {
                date_histogram: {
                    field: "LastDate",
                    interval: 'year',
                    format: 'yyyy',
                    min_doc_count: 0
                }
            }
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
        res.render("stats", {q: req.query.q, querystring: queryString(req.originalUrl), aggs: body.aggregations, filters: filters, open: Object.keys(filters).length > 0});
    }).catch(e => {
        console.log(e);
        res.render("stats", {q: req.query.q, querystring: queryString(req.originalUrl), aggs: {}, filters: {}, open: true, error: e});
    });
});

app.get("/allStats", (req, res) => {
    const sfilters = {pre: [], after: []};
    populateFilters(sfilters, req.query, []);
    search(queryObject(req.query.q), sfilters, 0, statsAggs, 0, runtimeMapping ).then(body => {
        res.json(body.aggregations);
    }).catch(err => {
        console.log(req.originalUrl, JSON.stringify(err.body))
        res.json({});
    });
});

function listAggregation(term){
    return {
        Tribunal: aggs.Tribunal,
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
                Tribunal: {
                    terms: {
                        field: 'Tribunal',
                        size: 25,
                        order: {
                            _term: "asc"
                        }
                    }
                }
            }
        }
    }
}

function groupByLetter(aggregations){
    const letters = {};
    for( let agg of aggregations ){
        let letter = (agg.key.replace(/[^a-zA-Z]/g, "#")[0] || "N.A.").toUpperCase();
        if( !letters[letter] ) letters[letter] = [];
        let tribunais = agg.Tribunal.buckets.map( o => o.key );
        letters[letter].push({value: agg.key, Tribunais: tribunais});
    }
    return letters
}

app.get("/indices", (req, res) => {
    const term = req.query.term || "Relator";
    const sfilters = {pre: [], after: []};
    const filters = populateFilters(sfilters, req.query, []);

    const fields = client.indices.getMapping({index: INDEXNAME}).then(body => Object.entries(body[INDEXNAME].mappings.properties).filter(o => o[1].fielddata || o[1].type == "keyword").map(o => ({key: o[0]})));
    search(queryObject(req.query.q), sfilters, 0, listAggregation(term), 0).then(async body => {
        res.render("list", {q: req.query.q, querystring: queryString(req.originalUrl), aggs: body.aggregations, letters: groupByLetter(body.aggregations[term].buckets), filters: filters, term: term, open: Object.keys(filters).length > 0, fields: await fields});
    }).catch(async err => {
        console.log(req.originalUrl, err)
        res.render("list", {q: req.query.q, querystring: queryString(req.originalUrl), error: err, aggs: {}, letters: {}, filters: {}, term: term, fields: await fields});
    });
});

app.get("/:ecli(ECLI:*)", (req, res) => {
    let ecli = req.params.ecli;
    search({term: {ECLI: ecli}}, {pre:[], after:[]}, 0, {}, 100, {_source: ['*'], fields: [DATA_FIELD]}).then((body) => {
        res.render("documents", {ecli, Processo: body.hits.hits[0]._source["Processo"], documents: body.hits.hits});
    }).catch(err => {
        console.log(req.originalUrl, err);
        res.render("documents", {ecli, error: err});
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

app.get("/docx/:ecli(ECLI:*)", (req, res) => {
    let ecli = req.params.ecli;
    search({term: {ECLI: ecli}}, {pre:[], after:[]}, 0, {}, 100, {_source: ['Decisão Texto Integral'], fields: []}).then((body) => {
        if( body.hits.total.value == 0 ){
            res.render("document", {ecli});
        }
        else if( body.hits.total.value == 1 ) {
            sendDocxOfHtml(res, body.hits.hits[0]._source["Decisão Texto Integral"], ecli);
        }
        else{
            let docnum = req.query.docnum;
            if( !docnum ){
                let html = ''
                for( let i = 0; i < body.hits.hits.length; i++ ){
                    html += `<li><a href=?docnum=${i}>Abrir documento ${i}</a></li>`
                }
                res.render("document", {ecli, error: `<ul><p>More than one document found.</p>${html}</ul>`});
            }
            else{
                sendDocxOfHtml(res, body.hits.hits[docnum]._source["Decisão Texto Integral"], ecli);
            }
        }
    }).catch(err => {
        console.log(req.originalUrl, err);
        res.render("document", {ecli, error: err});
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