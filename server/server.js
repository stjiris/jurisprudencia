const express = require('express');
const app = express();
const {Client} = require('@elastic/elasticsearch');
const client = new Client({node: 'http://localhost:9200'});
const path = require('path');

app.set('view engine', 'pug');
app.set('views', './views');

const {mappings: {properties}} = require('../elastic-index-mapping.json');
const aggs = {
    MinAno: {
        min: {
            field: 'PrimeiraData',
            format: 'yyyy'
        }
    },
    MaxAno: {
        max: {
            field: 'PrimeiraData',
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

let search = (
    query, // query string, ideally given by queryObject()
    filters={pre: [], after: []}, // filters to be applied, pre for before the query, after for after the query (affects aggregations)
    page=0, // page number [0, ...]
    saggs={Tribunal: aggs.Tribunal, MinAno: aggs.MinAno, MaxAno: aggs.MaxAno}, // aggregations to be applied
    rpp=RESULTS_PER_PAGE, // results per page
    extras={}  // extra fields to aply to the search if needed
) => client.search({
    index: 'jurisprudencia.1.0',
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
    runtime_mappings:{
        "PrimeiraData": {
            type: "date",
            format: "dd/MM/yyyy",
            script: "emit(doc['Data'].value.toInstant().toEpochMilli())"
        }   
    },
    aggs: saggs,
    size: rpp,
    from: page*rpp,
    sort: [
        { Data: "desc" }
    ],
    track_total_hits: true,
    _source: ["ECLI", "Tribunal", "Processo", "Relator", "Descritores", "Votação", "Meio Processual", "Secção", "Espécie", "Tipo", "Decisão", "Sumário"],
    fields: ["Data", "PrimeiraData"],
    ...extras
});

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

app.get("/", (req, res) => {
    const sfilters = {pre: [], after: []};
    const filtersUsed = populateFilters(sfilters, req.query);
    let page = parseInt(req.query.page) || 0;
    search(queryObject(req.query.q), sfilters, page).then(results => {
        res.render("search", {
            q: req.query.q, querystring: new URLSearchParams(req.query).toString(),            
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
            q: req.query.q, querystring: new URLSearchParams(req.query).toString(),
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
});

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
                    field: 'PrimeiraData',
                    interval: 'year',
                    format: 'yyyy'
                }
            }
        }
    }
}
app.get("/stats", (req, res) => {
    const sfilters = {pre: [], after: []};
    const filters = populateFilters(sfilters, req.query, []);
    search(queryObject(req.query.q), sfilters, 0, statsAggs, 0).then(body => {
        res.render("stats", {q: req.query.q, querystring: new URLSearchParams(req.query).toString(), aggs: body.aggregations, filters: filters, open: Object.keys(filters).length > 0});
    }).catch(err => {
        console.log(req.originalUrl, err)
        res.render("stats", {q: req.query.q, querystring: new URLSearchParams(req.query).toString(), error: err, aggs: {}, filters: {}, page: 0, pages: 0});
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
    search(queryObject(req.query.q), sfilters, 0, listAggregation(term), 0).then(body => {
        res.render("list", {q: req.query.q, querystring: new URLSearchParams(req.query).toString(), aggs: body.aggregations, letters: groupByLetter(body.aggregations[term].buckets), filters: filters, term: term, open: Object.keys(filters).length > 0});
    }).catch(err => {
        console.log(req.originalUrl, err)
        res.render("list", {q: req.query.q, querystring: new URLSearchParams(req.query).toString(), error: err, aggs: {}, letters: {}, filters: {}, term: term});
    });
});

app.get("/:ecli(ECLI:*)", (req, res) => {
    let ecli = req.params.ecli;
    client.search({
        index: 'jurisprudencia.1.0',
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
            res.render("document", {ecli, source: body.hits.hits[0]._source, aggs});
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
    search(queryObject(req.query.q), sfilters, 0, { [aggKey]: finalAgg}, 0).then(async body => {
        console.log(body)
        if( body.aggregations[aggKey].buckets.length < 10 ){
            body = await search(queryObject(req.query.q), sfilters, 0, { [aggKey]: agg }, 0);
        }
        res.render("datalist", {aggs: body.aggregations[aggKey].buckets, id: id});
    }).catch(err => {
        console.log(req.originalUrl, err.body.error);
        res.render("datalist", {aggs: [], error: err, id: id});
    });
});

app.use('/tinymce', express.static(path.join(require.resolve('tinymce'),'..')));
app.use(express.static(path.join(__dirname, "static")));


app.listen(9100)