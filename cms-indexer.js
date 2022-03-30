const getUrl = (off=0, pp=100) => `https://jurisprudencia.csm.org.pt/items/loadItems?sorts%5BdataAcordao%5D=1&perPage=${pp}&offset=${off}`
const https = require('https');
const { JSDOM } = require('jsdom');
const {ECLI_Builder} = require('./ecli');
const {Client} = require('@elastic/elasticsearch');
const esClient = new Client({ node: 'http://localhost:9200' });
const fs = require('fs/promises');
const httpsPromise = (url) => new Promise((resolve, reject) => {
    https.get(url, (res) => {
        let data = ''
        res.on('data', (chunk) => {
            data += chunk
        })
        res.on('end', () => {
            resolve(JSON.parse(data))
        })
    }).on('error', (e) => {
        reject(e)
    })
});

async function forEachCSMRecord(fn){
    let offset = 0;
    let perPage = 500;
    let url = getUrl(offset, perPage);
    while(true){
        let { records, queryRecordCount } = await httpsPromise(url);
        console.log(offset,"/", queryRecordCount);
        for(let r of records){
            await fn(r);
        }
        offset += perPage;
        if(offset >= queryRecordCount) break;
        url = getUrl(offset, perPage);
    }
}

console.log("Starting...");
forEachCSMRecord(async record => {
    let ECLI = ECLI_Builder.fromString(record.ecli);
    if( await fs.readFile(`./data/${record.ecli}.html`).then(_ => true).catch(_ => false) ){ return false; }
    if( await findEcli(ECLI) ){ return true; }
    
    let years = Object.values(record).filter(o => o.match(/\/\d{4}/g)).flatMap(o => o.match(/\/(\d{4})/g).map(s => s.substring(1)));
    for(let year of years){
        ECLI.setYear(year);
        if( await findEcli(ECLI) ){ return true; }
    }
    let dom = await JSDOM.fromURL(`https://jurisprudencia.csm.org.pt/ecli/${record.ecli}`);
    years = dom.window.document.querySelector("#descriptors").textContent.match(/\/\d{4}/g).map(s => s.substring(1));
    for(let year of years){
        ECLI.setYear(year);
        if( await findEcli(ECLI) ){ return true; }
    }
    await fs.writeFile(`./data/${record.ecli}.html`, dom.serialize());
});

async function findEcli(ecliObj){
    let E = ECLI_Builder.fromObject(ecliObj);
    E.setNumber(E.number.substr(0, Math.ceil(E.number.length/2)));
    let res = await esClient.search({
        index: 'jurisprudencia.0.0',
        query: {
            wildcard: {
                ECLI: `${E.build()}*`
            }
        }
    });
    return res.hits.total.value > 0;
}