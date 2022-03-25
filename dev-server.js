const express = require('express');
const app = express();
const {Client} = require('@elastic/elasticsearch');
const client = new Client({node: 'http://localhost:9200'});
const path = require('path');

app.set('view engine', 'pug');
app.set('views', './views');

const aggs = { // All possible aggregations, it should not be directly used, search() uses a subset by default
    Tribunal: {
        terms: {
            field: 'Tribunal',
            size: 20,
            order: {
                _term: "asc"
            },
            min_doc_count: 0
        }
    },
    Relator: {
        terms: {
            field: 'Relator',
            size: 65536
        }
    },
    Descritores: {
        terms: {
            field: 'Descritores.keyword',
            size: 65536
        }
    },
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
    },
    "Votação": {
        terms: {
            field: 'Votação',
            size: 65536,
            order: {
                _term: "asc"
            }
        }
    },
    "Meio Processual": {
        terms: {
            field: 'Meio Processual',
            size: 65536,
            order: {
                _term: "asc"
            }
        }
    },
    "Secção": {
        terms: {
            field: 'Secção',
            size: 65536,
            order: {
                _term: "asc"
            }
        }
    },
    "Espécie": {
        terms: {
            field: 'Espécie',
            size: 65536,
            order: {
                _term: "asc"
            }
        }
    },
    "Tipo": {
        terms: {
            field: 'Tipo',
            size: 65536,
            order: {
                _term: "asc"
            }
        }
    }
}

const RESULTS_PER_PAGE = 50;

let queryObject = (string, safe=false) => {
    if( !string ) return {
        match_all: {}
    };
    if( safe ){
        return {
            multi_match: {
                query: string, 
                type: "cross_fields"
            }
        }
    }
    return {
        query_string: { // TODO: change to simple_query_string
            query: string,
            default_operator: "AND"
        }
    };
}

let search = (
    query, // query string, ideally given by queryObject()
    filters={pre: [], after: []}, // filters to be applied, pre for before the query, after for after the query (affects aggregations)
    page=0, // page number [0, ...]
    saggs={Tribunal: aggs.Tribunal, MinAno: aggs.MinAno, MaxAno: aggs.MaxAno}, // aggregations to be applied
    rpp=RESULTS_PER_PAGE, // results per page
    extras={}  // extra fields to aply to the search if needed
    ) => client.search({
    index: 'jurisprudencia.0.0',
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
    sort: [
        { Data: "desc" }
    ],
    track_total_hits: true,
    _source: ["ECLI", "Tribunal", "Processo", "Relator", "Data", "Descritores", "Votação", "Meio Processual", "Secção", "Espécie", "Tipo", "Decisão", "Sumário"],
    ...extras
}).catch(e => {
    if( e.message.indexOf("Reason: Failed to parse query") != -1 ){
        console.log("Safe retrying after:", e.message);
        return search(queryObject(`${query.query_string.query}`, true), filters, page, saggs, rpp, extras);
    }
    else{
        return Promise.reject(e);
    }
})

app.get("/", (req, res) => search(queryObject(req.query.q)).then(body => {
    res.render("search", {q: req.query.q, body: body, hits: body.hits.hits, aggs: body.aggregations, filters: {}, page: 0, pages: Math.ceil(body.hits.total.value/RESULTS_PER_PAGE)});
}).catch(err => {
    console.log(req.originalUrl, err)
    res.render("search", {q: req.query.q, body: {}, hits: [], error: err, aggs: {}, filters: {}, page: 0, pages: 0});
}));

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
            if( aggName == "Tribunal" ){
                filters[when].push({
                    terms: {
                        [aggObj[aggField].field]: filtersUsed[aggName]
                    }
                });
            }
            if( aggName == "Relator" ){
                filtersUsed[aggName].forEach(relator => {
                    filters[when].push({
                        wildcard: {
                            [aggObj[aggField].field]: { value: `*${relator}*` }
                        }
                    });
                });
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
        }
    }
    if( body.MinAno ){
        filtersUsed.MinAno = body.MinAno;
        let when = "pre";
        if( afters.indexOf("MinAno") != -1 ){
            when = "after";
        }
        filters[when].push({
            range: {
                Data: {
                    gte: body.MinAno,
                    format: "yyyy"
                }
            }
        });
    }
    if( body.MaxAno ){
        filtersUsed.MaxAno = body.MaxAno;
        let when = "pre";
        if( afters.indexOf("MaxAno") != -1 ){
            when = "after";
        }
        filters[when].push({
            range: {
                Data: {
                    lt: parseInt(body.MaxAno)+1 || new Date().getFullYear(),
                    format: "yyyy"
                }
            }
        });
    }
    return filtersUsed;
}

app.post("/", express.urlencoded({extended: true}), (req, res) => {
    const sfilters = {pre: [], after: []};
    const filters = populateFilters(sfilters, req.body);
    let page = parseInt(req.body.page) || 0;
    search(queryObject(req.body.q), sfilters, page).then(body => {
        res.render("search", {q: req.body.q, body: body, hits: body.hits.hits, aggs: body.aggregations, filters: filters, page: page, pages: Math.ceil(body.hits.total.value/RESULTS_PER_PAGE), open: true});
    }).catch(err => {
        console.log(req.originalUrl, err)
        res.render("search", {q: req.body.q, body: {}, hits: [], error: err, aggs: {}, filters: {}, page: 0, pages: 0});
    });  
})

const statsAggs = {
    Tribunal: aggs.Tribunal,
    MinAno: aggs.MinAno,
    MaxAno: aggs.MaxAno,
    Anos: {
        terms: {
            field: 'Tribunal',
            size: 20,
        },
        aggs: {
            Anos: {
                date_histogram: {
                    field: 'Data',
                    interval: 'year',
                    format: 'yyyy'
                }
            }
        }
    }
}
app.get("/stats", (req, res) => {
    search(queryObject(req.query.q), [], 0, statsAggs, 0).then(body => {
        res.render("stats", {q: req.query.q, aggs: body.aggregations, filters: {}});
    }).catch(err => {
        console.log(req.originalUrl, err)
        res.render("stats", {q: req.query.q, error: err, aggs: {}, filters: {}, page: 0, pages: 0});
    });
});
app.post("/stats", express.urlencoded({extended: true}), (req, res) => {
    const sfilters = {pre: [], after: []};
    const filters = populateFilters(sfilters, req.body, []);
    search(queryObject(req.body.q), sfilters, 0, statsAggs, 0).then(body => {
        res.render("stats", {q: req.body.q, aggs: body.aggregations, filters: filters, open: true});
    }).catch(err => {
        console.log(req.originalUrl, err)
        res.render("stats", {q: req.body.q, error: err, aggs: {}, filters: {}, page: 0, pages: 0});
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
        let letter = agg.key.replace(/[^a-zA-Z]/g, "#")[0] || "N.A.";
        if( !letters[letter] ) letters[letter] = [];
        let tribunais = agg.Tribunal.buckets.map( o => o.key );
        letters[letter].push({value: agg.key, Tribunais: tribunais});
    }
    return letters
}

app.get("/list", (req, res) => {
    const term = req.query.term || "Relator";
    search(queryObject(req.query.q), [], 0, listAggregation(term), 0).then(body => {
        res.render("list", {q: req.query.q, aggs: body.aggregations, letters: groupByLetter(body.aggregations[term].buckets), filters: {}, term: term});
    }).catch(err => {
        console.log(req.originalUrl, err)
        res.render("list", {q: req.query.q, error: err, aggs: {}, letters: {}, filters: {}, term: term, page: 0, pages: 0});
    });
});

app.post("/list", express.urlencoded({extended: true}), (req, res) => {
    const term = req.query.term || "Relator";
    const sfilters = {pre: [], after: []};
    const filters = populateFilters(sfilters, req.body, []);
    search(queryObject(req.body.q), sfilters, 0, listAggregation(term), 0).then(body => {
        res.render("list", {q: req.body.q, aggs: body.aggregations, letters: groupByLetter(body.aggregations[term].buckets), filters: filters, term: term, open: true});
    }).catch(err => {
        console.log(req.originalUrl, err.meta.body.error);
        res.render("list", {q: req.body.q, error: err, aggs: {}, letters: {}, filters: {}, term: term, page: 0, pages: 0});
    });
});

app.get("/:ecli(ECLI:*)", (req, res) => {
    let ecli = req.params.ecli;
    client.search({
        index: 'jurisprudencia.0.0',
        body: {
            query: {
                term: {
                    ECLI: ecli
                }
            }
        }
    }).then((body) => {
        if( body.hits.total.value == 0 ){
            res.render("document", {ecli});
        } else {
            res.render("document", {ecli, source: body.hits.hits[0]._source});
        }
    }).catch(err => {
        console.log(req.originalUrl, err);
        res.render("document", {ecli, error: err});
    });
});

app.get("/datalist", (req, res) => {
    // id=relatores&agg=Relator&tribunais=
    let aggKey = req.query.agg;
    let agg = aggs[aggKey];
    let id = req.query.id || "";
    if( !agg ) {
        res.render("datalist", {aggs: [], error: "Aggregation not found", id: req.query.id});
        return;
    }
    let finalAgg = {
        significant_terms: agg.terms
    }
    const sfilters = {pre: [], after: []};
    populateFilters(sfilters, req.query, [], []);
    search(queryObject(req.query.q), sfilters, 0, { [aggKey]: finalAgg}, 0).then(async body => {
        if( body.aggregations[aggKey].buckets.length < 10 ){
            body = await search(queryObject(req.query.q), sfilters, 0, { [aggKey]: agg });
        }
        res.render("datalist", {aggs: body.aggregations[aggKey].buckets, id: req.query.id});
    }).catch(err => {
        console.log(req.originalUrl, err.body.error);
        res.render("datalist", {aggs: [], error: err, id: req.query.id});
    });
});

app.use(express.static(path.join(__dirname, "static")));

app.listen(9100)