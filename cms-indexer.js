const getUrl = (off=0, pp=100) => `https://jurisprudencia.csm.org.pt/items/loadItems?sorts%5BdataAcordao%5D=1&perPage=${pp}&offset=${off}`
const https = require('https');
const { JSDOM } = require('jsdom');
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
    let perPage = 10;
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
forEachCSMRecord(record => JSDOM.fromURL(`https://jurisprudencia.csm.org.pt/ecli/${record.ecli}/`).then(dom => {
        let meta = getChildRemoveTitle(dom, "#descriptors");
        let summary = getChildRemoveTitle(dom, "#summary");
        let intText = getChildRemoveTitle(dom, "#integral-text");
        let parText = getChildRemoveTitle(dom, "#parcial-text");
        if( parText.textContent.trim() != "Não disponível." ){
            console.log(`${record.ecli} ${parText.textContent.trim()}`);
        }
    })).catch(e => console.log(e));

function getChildRemoveTitle(dom, selector){
    let child = dom.window.document.querySelector(selector);
    let title = child.querySelector(".main-title");
    if( title ){
        title.remove();
    }
    return child;
}