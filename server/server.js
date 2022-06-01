const express = require('express');
const app = express();
const {Client} = require('@elastic/elasticsearch');
const client = new Client({node: 'http://localhost:9200'});
const path = require('path');

app.set('view engine', 'pug');
app.set('views', './views');

const {mappings: {properties}, index: INDEXNAME} = require('../elastic-index-mapping.json');
const aggs = {
    MinAno: {
        min: {
            field: 'Data',
            format: 'yyyy'
        }
    },
    MaxAno: {
        max: {
            field: 'Data',
            format: 'yyyy'
        }
    }
};
for( p in properties ){
    aggs[p] = {
        terms: {
            field: p,
            size: 65536,
            order: {
                _term: "asc",
            }
        }
    }
}

aggs["Descritores"].terms.field = "Descritores.keyword";
aggs["Tribunal"].terms.min_doc_count = 0;
aggs["Código Tribunal"].terms.min_doc_count = 0;

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
    tmp(name, { properties, ...obj }, next);
}

const DEFAULT_AGGS = {Tribunal: aggs.Tribunal};


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
            filter: filters.pre // Hide documents from aggregations
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
    fields: ["Data"],
    ...extras
});

const padZero = (num, size=4) => {
    let s = num.toString();
    while( s.length < size ){
        s = "0" + s;
    }
    return s;
}

const populateFilters = (filters, body={}, afters=["Tribunal"]) => { // filters={pre: [], after: []}
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
            if( aggName == "Descritores" ){
                filtersUsed[aggName].forEach(descritor => {
                    filters[when].push({
                        wildcard: {
                            [aggObj[aggField].field]: { value: `*${descritor}*` }
                        }
                    });
                });
            }
            else if( aggName == "Relator" ){
                filtersUsed[aggName].forEach(relator => {
                    filters[when].push({
                        wildcard: {
                            [aggObj[aggField].field]: { value: `*${relator}*` }
                        }
                    });
                });
            }
            else{
                    filters[when].push({
                        terms: {
                            [aggObj[aggField].field]: filtersUsed[aggName]
                        }
                    });
            }
        }
    }
    if( body.MinAno && body.MaxAno ){
        filtersUsed.MinAno = body.MinAno;
        filtersUsed.MaxAno = body.MaxAno;
        filters.pre.push({
            range: {
                Data: {
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
                Data: {
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
                Data: {
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
                exists: {
                    field: field
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
            Data: "desc"
        });
    }
    else if( sortV == "asc" ){
        array.push({
            Data: "asc"
        });
    }
    else if( sortV == "score" ){
        array.push({
            _score: "desc"
        });
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
            "*": { type: "unified" }
        }
    };
    search(queryObject(req.query.q), sfilters, page, {}, RESULTS_PER_PAGE, { sort, highlight }).then(results => {
        res.render("acord-article", {
            hits: results.hits.hits,
        });
    }).catch(e => {
        console.log(e);
        res.render("acord-article", {
            hits: []
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

let runtimeMapping = {
    runtime_mappings: {
        LastDate: {
            type: "date",
            format: "yyyy",
            script: `
                def lastDate = doc['Data'][0];
                for( item in doc['Data'] ){
                    if( item.getMillis() > lastDate.getMillis() ){
                        lastDate = item;
                    }
                }
                emit(lastDate.getMillis());
            `
        }
    }
}

app.get("/stats", (req, res) => {
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
    const filters = populateFilters(sfilters, req.query, []);
    search(queryObject(req.query.q), sfilters, 0, statsAggs, 0, runtimeMapping ).then(body => {
        res.json(body.aggregations);
    }).catch(err => {
        console.log(req.originalUrl, err)
        res.json({});
    });
});

function listAggregation(term){
    return {
        Tribunal: aggs.Tribunal,
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

app.get("/list", (req, res) => {
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
    search({term: {ECLI: ecli}}, {pre:[], after:[]}, 0, {}, 100, {_source: ['*'], fields: ['Data']}).then((body) => {
        if( body.hits.total.value == 0 ){
            res.render("document", {ecli});
        }
        else if( body.hits.total.value == 1 ) {
            res.render("document", {ecli, source: body.hits.hits[0]._source, fields: body.hits.hits[0].fields, aggs});
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
                res.render("document", {ecli, source: body.hits.hits[docnum]._source, fields: body.hits.hits[docnum].fields, aggs});
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
    populateFilters(sfilters, req.query, [], []);
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

app.use('/test-anonimizador', (_, res) => res.render("anonimizador"));

app.use('/table', require('./tables'));
app.use('/dashboard', require('./dashboard'));
app.use('/tinymce', express.static(path.join(require.resolve('tinymce'),'..')));
app.use('/stats-sse', require('./csm-errados'))
app.use(express.static(path.join(__dirname, "static")));

app.listen(9100)