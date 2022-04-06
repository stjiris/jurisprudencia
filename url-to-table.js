let {JSDOM} = require("jsdom");
let https = require('https');
let http = require('http');
const { URL } = require("url");

let sleep = (time) => new Promise(resolve => setTimeout(resolve, time))
let getHtml = (url) => new Promise((resolve, reject) => {
    let urlObj = new URL(url);
    let resFunction = (res) => {
        let data = "";
        res.setEncoding('utf8');
        res.on('data', (d) => data += d);
        res.on('end', () => {
            resolve(data);
        });
    }
    let headers = {
        'Accept': 'text/html,application/xhtml+xml,application/xml',
        'Accept-Language': 'pt-PT,pt;q=0.9',
        'Accept-Charset': 'utf-8'
    }
    if( urlObj.protocol == "https:" ){
        https.get(url, {headers}, resFunction).on('error', reject);
    } else {
        http.get(url, {headers}, resFunction).on('error', reject);
    }
});

let getPage = (url) => new Promise(async resolve => {
    let html = await getHtml(url).catch( e => null )
    let seconds = 5;
    while(html == null){
        console.log(`getPage(${url}): Retrying in ${seconds}s`);
        await sleep(seconds*1000);
        seconds *= 2;
        html  = await getHtml(url).catch(e => null);
    }
    resolve(new JSDOM(html, { url }));
});

let parsers = []
let addParser = (regex, lambda) => {
    parsers.push({regex, lambda});
}

addParser(/http:\/\/www\.dgsi\.pt\/(?<tribcod>.*)\.nsf\/(?<hashtrib>.*)\/(?<hashdoc>.*)\?OpenDocument/, (page, url, match, extras) => {
    let tables = Array.from(page.window.document.querySelectorAll("table")).filter( o => o.parentElement.closest("table") == null );
    let table = tables.flatMap( table => Array.from(table.querySelectorAll("tr")).filter( row => row.closest("table") == table ) )
        .filter( tr => tr.cells.length > 1 )
        .reduce((acc, tr) => {
                let key = tr.cells[0].textContent.replace(":","").trim()
                let value = tr.cells[1];  
                acc[key] = value;
                return acc;
        }, {});
    return table;
});

addParser(/jurisprudencia.csm.org.pt\/ecli\/ECLI:PT:(?<tribcod>[^:]*):(?<year>\d{4}):(?<proc>.*)\//, (page, url, match, extras) => {
    let table = {}
    let metaParent = page.window.document.getElementById("descriptors");
    for( let metaObjectTitle of metaParent.querySelectorAll('.content-title')){
        let metaObjectValue = metaObjectTitle.parentElement.querySelector('.content');
        table[metaObjectTitle.textContent.replace(":","").trim()] = metaObjectValue;
    }
    table["Sumário"] = page.window.document.querySelector("#summary");
    table["Sumário"].querySelector('.main-title').remove();
    table["Texto"] = page.window.document.querySelector("#integral-text");
    table["Texto"].querySelector('.main-title').remove();
    return table;
})

module.exports = async function(url){
    for(let {regex, lambda} of parsers){
        let match = url.match(regex);
        if(match){
            let page = await getPage(url);
            let table = lambda(page, url, match, {});
            return table;
        }
    }
}