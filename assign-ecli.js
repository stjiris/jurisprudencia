const es = require('@elastic/elasticsearch');
const { appendFileSync } = require('fs');
const client = new es.Client({ node: process.env.ES_URL || 'http://localhost:9200' });
const jurisprudencia = require('./jurisprudencia');
const ECLI = require("./util/ecli")

let know_eclis = [];
require("fs").readFileSync("eclis.txt").toString().split("\n").forEach( e => e != '' && know_eclis.indexOf(e) == -1 ? know_eclis.push(e) : null )

function findMathingECLI(ecli){
    return know_eclis.filter( o => o.indexOf(ecli) == 0)
}

let builder = new ECLI().setCountry("PT").setJurisdiction("STJ").setYear("0000");

let timeSinceLastRequest = new Date();
async function getOfficialECLI(process, date){
    let year = date.match(/\d{4}/)[0];
    let maybeECLI = builder.setYear(year).setNumber(process).build();
    let cached = findMathingECLI(maybeECLI);
    if( cached.length > 1 ) {
        let subCached = cached.filter( o => o.indexOf(maybeECLI+'.') == 0);
        if( subCached.length > 1 ){
            // it is cached but we dont have date info retry
            cached = []
        };
        cached = subCached;
    }; // Too many matching values
    let trueECLI = cached[0];
    if( !trueECLI ){
        let needsSleep = new Date() - timeSinceLastRequest;
        if( needsSleep<10000 ){
            await fetch.sleep(10000-needsSleep)
        }
        timeSinceLastRequest = new Date();
        let url = `https://jurisprudencia.csm.org.pt/items/loadItems?queries[courts][]=1&sorts[dataAcordao]=-1&queries[filter_unique_number]=${encodeURIComponent(process)}`
        console.error("Fetching", url)
        let r = await fetch.json(url);
        if( r.records.length == 1 ){
            trueECLI = r.records[0].ecli;
        }
        else if(r.records.length > 1 ){
            let matchingEclis = r.records.filter( o => o.dataAcordao == date );
            if( matchingEclis.length == 1 ){
                trueECLI = matchingEclis[0].ecli;
            }
        }
        if( trueECLI && findMathingECLI(trueECLI).length == 0 ){
            appendFileSync("eclis.txt", trueECLI+'\n')
        }
    }
    return trueECLI;
}

const fetch = require('./util/fetch');

client.search({
    index: jurisprudencia.Index,
    query: {
        term: {
            ECLI: "sem ECLI"
        }
    },
    _source: ["Processo","Data"],
    scroll: '3m'
}).then(async r => {
    while(r.hits.hits.length > 0){
        for( let hit of r.hits.hits ){
            let data = hit._source["Data"];
            let proc = hit._source["Processo"];
            let ecli = await getOfficialECLI(proc, data);
            if( ecli ){
                await client.update({
                    index: hit._index,
                    id: hit._id,
                    doc: {
                        ECLI: ecli
                    }
                })
            }
        }
        r = await client.scroll({scroll: '1m', scroll_id: r._scroll_id})
    }
})