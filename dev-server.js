const express = require('express');
const app = express();
const {Client} = require('@elastic/elasticsearch');
const client = new Client({node: 'http://localhost:9200'});
const path = require('path');

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
            default_operator: "AND"
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
    sort: [
        { Data: "desc" }
    ],
    track_total_hits: true
});

app.get("/", (req, res) => search(queryObject(req.query.q)).then(body => {
    res.render("search", {q: req.query.q, hits: body.hits.hits, aggs: body.aggregations, filters: {}, page: 0, pages: Math.ceil(body.hits.total.value/RESULTS_PER_PAGE)});
}).catch(err => {
    console.log(err)
    res.render("search", {q: req.query.q, hits: [], error: err, aggs: {}, filters: {}, page: 0, pages: 0});
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
            filters[when].push({
                terms: {
                    [aggObj[aggField].field]: filtersUsed[aggName]
                }
            });
        }
    }
    if( body.MinAno ){
        filtersUsed.MinAno = body.MinAno;
        filters.pre.push({
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
        filters.pre.push({
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
        res.render("search", {q: req.body.q, hits: body.hits.hits, aggs: body.aggregations, filters: filters, page: page, pages: Math.ceil(body.hits.total.value/RESULTS_PER_PAGE), open: true});
    }).catch(err => {
        console.log(err)
        res.render("search", {q: req.body.q, hits: [], error: err, aggs: {}, filters: {}, page: 0, pages: 0});
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
        console.log(err)
        res.render("stats", {q: req.query.q, error: err, aggs: {}, filters: {}, page: 0, pages: 0});
    });
});
app.post("/stats", express.urlencoded({extended: true}), (req, res) => {
    const sfilters = {pre: [], after: []};
    const filters = populateFilters(sfilters, req.body);
    search(queryObject(req.body.q), sfilters, 0, statsAggs, 0).then(body => {
        res.render("stats", {q: req.body.q, aggs: body.aggregations, filters: filters, open: true});
    }).catch(err => {
        console.log(err)
        res.render("stats", {q: req.body.q, error: err, aggs: {}, filters: {}, page: 0, pages: 0});
    });
});

const relatoresAggs = {
    Tribunal: aggs.Tribunal,
    Relator: {
        terms: {
            field: 'Relator',
            size: 1000000
        },
        aggs: {
            Tribunal: {
                terms: {
                    field: 'Tribunal',
                    size: 20
                }
            }
        }
    },
};
app.get("/relatores", (req, res) => {
    search(queryObject(req.query.q), [], 0, relatoresAggs, 0).then(body => {
        res.render("relatores", {q: req.query.q, aggs: body.aggregations, filters: {}});
    }).catch(err => {
        console.log(err)
        res.render("relatores", {q: req.query.q, error: err, aggs: {}, filters: {}, page: 0, pages: 0});
    });
});
app.post("/relatores", express.urlencoded({extended: true}), (req, res) => {
    const sfilters = {pre: [], after: []};
    const filters = populateFilters(sfilters, req.body, []);
    search(queryObject(req.body.q), sfilters, 0, relatoresAggs, 0).then(body => {
        res.render("relatores", {q: req.body.q, aggs: body.aggregations, filters: filters, open: true});
    }).catch(err => {
        console.log(err)
        res.render("relatores", {q: req.body.q, error: err, aggs: {}, filters: {}, page: 0, pages: 0});
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

app.use(express.static(path.join(__dirname, "static")));

app.listen(9100)