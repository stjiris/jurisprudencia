const { Client } = require("@elastic/elasticsearch");
const client = new Client({
    node: "http://localhost:9200"
});
const {Router} = require("express")
const {scroll} = require("../indexer");
const INDEX = 'jurisprudencia.1.0';
const ECLI = require("../util/ecli");

const app = Router();
module.exports = app;

const UNMATCH_QUERY = {
    exists: {
        field: "_UNMATCHING_ECLI"
    }
}

app.get("/", async (req, res) => {
    res.set({
        'Cache-Control': 'no-cache',
        'Content-Type': 'text/event-stream',
        'Connection': 'keep-alive'
    });
    res.flushHeaders();
    let minDist = req.query.minDist || 3;

    client.count({ index: INDEX, query: UNMATCH_QUERY }).then(count => res.write(`event: UnmatchingECLICountEvent\ndata: ${count.count}\n\n`));
    client.count({ index: INDEX, query: { term: {Origem: "csm-indexer"} } }).then(count => res.write(`event: CSMCountEvent\ndata: ${count.count}\n\n`));

    for await (const {_source, fields} of scroll({
        index: INDEX,
        size: 1,
        query: UNMATCH_QUERY,
        fields: ["Data"]
    })) {
        let original = new ECLI();
        try{
            original = ECLI.fromString(_source._UNMATCHING_ECLI.toUpperCase())
        }
        catch(e){
            console.log(e)
        }
        let generated = ECLI.fromString(_source.ECLI)
        let distance = {}
        let t=0;
        for( let key in original ) {
            distance[key] = {}
            distance[key].original = original[key]
            distance[key].generated = generated[key]
            distance[key].distance = levenshtein(original[key], generated[key])
            t+=distance[key].distance
        }        

        _source["ECLIDistance"] = distance;
        _source["Data"] = fields["Data"];
        if( t > minDist ) {
            res.write(`event: UnmatchingECLIEvent\n`);
            res.write(`data: ${JSON.stringify(_source)}\n\n`);
        }
    }

    res.write(`event: EndEvent\ndata:\n\n`);
})


function sendEvent(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}


function levenshtein(s1, s2) {
    var l1 = s1.length;
    var l2 = s2.length;
    var d = [];
    var i, j, s;
    for (i = 0; i <= l1; i++) {
        d[i] = [];
        d[i][0] = i;
    }
    for (j = 0; j <= l2; j++) {
        d[0][j] = j;
    }
    for (i = 1; i <= l1; i++) {
        for (j = 1; j <= l2; j++) {
            s = (s1.charAt(i - 1) == s2.charAt(j - 1)) ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + s);
        }
    }
    return d[l1][l2];
}
