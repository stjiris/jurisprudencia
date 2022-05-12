const {Router, static} = require("express");
const indexer = require("../indexer");
const path = require("path");

const app = Router();
module.exports = app;

app.get("/", (req, res) => {
    indexer._client.search({
        size: 0,
        aggs: {
            Histogram: {
                date_histogram: {
                    field: "Data",
                    interval: "year",
                    format: "yyyy",
                    min_doc_count: 0
                },
                aggs: {
                    Origem: {
                        terms: {
                            field: "Origem",
                            size: 20,
                            min_doc_count: 0
                        }
                    },
                    WrongECLI: {
                        filter: {
                            bool: {
                                must: {
                                    exists: {
                                        field: "_UNMATCHING_ECLI"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }).then(body => {
        let Anos = body.aggregations.Histogram.buckets.map(bucket => bucket.key_as_string);
        let keys = body.aggregations.Histogram.buckets[0].Origem.buckets.map(bucket => bucket.key);
        let values = Anos.map(Ano => {
            let Total = body.aggregations.Histogram.buckets.find(bucket => bucket.key_as_string === Ano).doc_count;
            let WrongECLI = body.aggregations.Histogram.buckets.find(bucket => bucket.key_as_string === Ano).WrongECLI.doc_count;
            let values = keys.map(key => body.aggregations.Histogram.buckets.find(bucket => bucket.key_as_string === Ano).Origem.buckets.find(bucket => bucket.key === key)?.doc_count || 0);
            return [Ano,...values,Total,WrongECLI];
        });
        res.render("info-table", {
            header: ["Ano",...keys,"Total","TotalWrongECLI"],
            values: values
        });
    }).catch(err => {
        res.render("info-table", {
            header: ["ECLI","Origem","Total","TotalWrongECLI"],
            values: [],
            error: err
        });
    });
});

app.get("/duplicates", (req, res) => {
    indexer._client.search({
        size: 0,
        aggs: {
            ECLI: {
                terms: {
                    field: "ECLI",
                    min_doc_count: 2,
                    size: 65536/4,
                    collect_mode: "breadth_first"
                },
                aggs: {
                    Origem: {
                        terms: {
                            field: "Origem",
                            size: 4
                        }
                    }
                }
            }
        }
    }).then(body => {
        let ECLI = body.aggregations.ECLI.buckets;
        let values = ECLI.map(ECLI => {
            return [`<a href="/${ECLI.key}">${ECLI.key}</a>`, ECLI.Origem.buckets.map(bucket => bucket.key).join(", "), ECLI.doc_count];
        });
        res.render("info-table", {
            header: ["ECLI", "Origem", "Contagem (Incorreto)"],
            values: values
        });
    }).catch(err => {
        res.render("info-table", {
            header: ["ECLI","Origem", "Contagem (Incorreto)"],
            values: [],
            error: err
        });
    });
});

app.use(static(path.join(__dirname, "static")));