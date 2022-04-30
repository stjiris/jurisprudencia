const https = require('https');
const http = require('http');
const { URL } = require("url");
const { JSDOM } = require("jsdom");

const sleep = (time) => new Promise(resolve => setTimeout(resolve, time))

const fetch = module.exports = (url, options={}) => new Promise((resolve, reject) => {
    let urlObj = new URL(url);
    let resFunction = (res) => {
        res.setEncoding('utf-8');
        let data = "";
        res.on('data', (d) => data += d);
        res.on('end', () => {
            resolve(data);
        });
    }
    if( urlObj.protocol == "https:" ){
        https.get(url, options, resFunction).on('error', reject);
    } else {
        http.get(url, options, resFunction).on('error', reject);
    }
});

const fetchRetry = module.exports.fetchRetry = async (url, options={}) => {
    let result = null;
    let interval = 1;
    while( result == null ){
        result = await fetch(url, options).catch(async e => {
            console.log(`fetchRetry(${url}) in ${interval}s: ${e.message}`);
            await sleep(interval*1000);
            interval *= 2;
            return null;
        });
    }
    return result;
}

const fetchRetryJSON = module.exports.fetchRetryJSON = async (url, options={}) => {
    let result = null;
    let interval = 1;
    while( result == null ){
        result = await fetchRetry(url, options).then(JSON.parse).catch(async e => {
            console.log(`fetchRetryJSON(${url}) in ${interval}s: ${e.message}`);
            await sleep(interval*1000);
            interval *= 2;
            return null;
        });
    }
    return result;
}

const DOM_DEFAULT_OPTIONS = {
    headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml',
        'Accept-Language': 'pt-PT,pt',
        'Accept-Charset': 'utf-8'
    }
}

module.exports.json = (url, options={}) => fetchRetryJSON(url, options);
module.exports.dom = (url, options=DOM_DEFAULT_OPTIONS) => fetchRetry(url, options).then(dom => new JSDOM(dom, { url: url }));
module.exports.sleep = sleep;

