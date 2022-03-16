const express = require('express');
const app = express();
const {Client} = require('@elastic/elasticsearch');
const client = new Client({node: 'http://localhost:9200'});

app.set('view engine', 'pug');
app.set('views', './views');

const aggs = {
    Tribunal: {
        terms: {
            field: 'Tribunal',
            size: 20,
            order: {
                "_term": "asc"
            }
        }
    },
    Relator: {
        significant_terms: {
            field: 'Relator',
            size: 100000
        }
    },
    Descritores: {
        significant_terms: {
            field: 'Descritores.keyword',
            size: 100000
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
    }
}

const RESULTS_PER_PAGE = 50;

let queryObject = (string) => {
    if( !string ) return {
        match_all: {}
    };
    return {
        query_string: {
            query: string,
        }
    };
}

let search = (query, filters={pre: [], after: []}, page=0, saggs={Tribunal: aggs.Tribunal, MinAno: aggs.MinAno, MaxAno: aggs.MaxAno}, rpp=RESULTS_PER_PAGE) => client.search({
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
    track_total_hits: true
});

app.get("/", (req, res) => search(queryObject(req.query.q)).then(body => {
    res.render("search", {q: req.query.q, hits: body.hits.hits, aggs: body.aggregations, filters: {}, page: 0, pages: Math.ceil(body.hits.total.value/RESULTS_PER_PAGE)});
}).catch(err => {
    console.log(err)
    res.render("search", {q: req.query.q, hits: [], error: err, aggs: {}, filters: {}, page: 0, pages: 0});
}))

app.post("/", express.urlencoded({extended: true}), (req, res) => {
    const sfilters = {pre: [], after: []};
    const filters = {};
    for( let key in aggs ) {
        let field = "terms";
        if( !aggs[key][field] ) {
            field = "significant_terms";
        }
        if( !aggs[key][field] ) {
            continue;
        }
        if( req.body[key] ) {
            filters[key] = (Array.isArray(req.body[key]) ? req.body[key] : [req.body[key]]).filter(o => o.length > 0);
            sfilters.pre.push({
                terms: {
                    [aggs[key][field].field]: filters[key]
                }
            });
        }
    }
    if( req.body.MinAnos ) {
        filters.MinAnos = req.body.MinAnos;
        sfilters.pre.push({
            range: {
                Data: {
                    gte: req.body.MinAnos,
                    format: "yyyy"
                }
            }
        });
    }
    if( req.body.MaxAnos ) {
        filters.MaxAnos = req.body.MaxAnos;
        sfilters.pre.push({
            range: {
                Data: {
                    lte: parseInt(req.body.MaxAnos)+1,
                    format: "yyyy"
                }
            }
        });
    }
    let page = parseInt(req.body.page) || 0;
    search(queryObject(req.body.q), sfilters, page).then(body => {
        res.render("search", {q: req.body.q, hits: body.hits.hits, aggs: body.aggregations, filters: filters, page: page, pages: Math.ceil(body.hits.total.value/RESULTS_PER_PAGE), open: true});
    }).catch(err => {
        console.log(err)
        res.render("search", {q: req.body.q, hits: [], error: err, aggs: {}, filters: {}, page: 0, pages: 0});
    });  
})
app.get("/stats", (req, res) => {
    let saggs = {
        Tribunal: aggs.Tribunal,
        MinAno: aggs.MinAno,
        MaxAno: aggs.MaxAno,
        Anos: {
            terms: {
              field: "Tribunal",
              size: 20
            },
            aggs: {
                Anos: {
                    date_histogram: {
                        field: "Data",
                        interval: "year",
                        format: "yyyy"
                    }
                }
            }
        }
    }
    search(queryObject(req.query.q), [], 0, saggs, 0).then(body => {
        res.render("stats", {q: req.query.q, aggs: body.aggregations, filters: {}});
    }).catch(err => {
        console.log(err)
        res.render("stats", {q: req.query.q, error: err, aggs: {}, filters: {}, page: 0, pages: 0});
    });
})
app.post("/stats", express.urlencoded({extended: true}), (req, res) => {
    const sfilters = {pre: [], after: []};
    const filters = {};
    for( let key in aggs ) {
        let field = "terms";
        if( !aggs[key][field] ) {
            field = "significant_terms";
        }
        if( !aggs[key][field] ) {
            continue;
        }
        if( req.body[key] ) {
            filters[key] = (Array.isArray(req.body[key]) ? req.body[key] : [req.body[key]]).filter(o => o.length > 0);
            sfilters.pre.push({
                terms: {
                    [aggs[key][field].field]: filters[key]
                }
            });
        }
    }
    if( req.body.MinAnos ) {
        filters.MinAnos = req.body.MinAnos;
        sfilters.pre.push({
            range: {
                Data: {
                    gte: req.body.MinAnos,
                    format: "yyyy"
                }
            }
        });
    }
    if( req.body.MaxAnos ) {
        filters.MaxAnos = req.body.MaxAnos;
        sfilters.pre.push({
            range: {
                Data: {
                    lte: parseInt(req.body.MaxAnos)+1,
                    format: "yyyy"
                }
            }
        });
    }
    let saggs = {
        Tribunal: aggs.Tribunal,
        MinAno: aggs.MinAno,
        MaxAno: aggs.MaxAno,
        Anos: {
            terms: {
              field: "Tribunal",
              size: 20
            },
            aggs: {
                Anos: {
                    date_histogram: {
                        field: "Data",
                        interval: "year",
                        format: "yyyy"
                    }
                }
            }
        }
    }
    search(queryObject(req.body.q), sfilters, 0, saggs, 0).then(body => {
        res.render("stats", {q: req.body.q, aggs: body.aggregations, filters: filters, open: true});
    }).catch(err => {
        console.log(err)
        res.render("stats", {q: req.body.q, error: err, aggs: {}, filters: {}, page: 0, pages: 0});
    });
})

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
            throw new Error(`ECLI ${ecli} not found`);
        } else {
            res.render("document", {ecli, source: body.hits.hits[0]._source});
        }
    }).catch(err => {
        console.log(err);
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
    let filter = [];
    if( req.query.tribunais ) {
        filter.push({
            terms: {
                Tribunal: req.query.tribunais.split(",")
            }
        });
    }
    search(queryObject(req.query.q), filter, 0, { [aggKey]: agg}).then(body => {
        res.render("datalist", {aggs: body.aggregations[aggKey].buckets, id: req.query.id});
    }).catch(err => {
        console.log(err);
        res.render("datalist", {aggs: [], error: err, id: req.query.id});
    });
});

app.listen(9100)