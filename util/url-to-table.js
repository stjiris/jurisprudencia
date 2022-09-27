let fetch = require("./fetch");

let getHTMLPage = (url) => fetch.dom(url);

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
    table["Decisão Texto Integral"] = page.window.document.querySelector("#integral-text");
    table["Decisão Texto Integral"].querySelector('.main-title').remove();
    return table;
})

module.exports = async function(url){
    for(let {regex, lambda} of parsers){
        let match = url.match(regex);
        if(match){
            let table = null;
            let interval = 1;
            while( table == null ){
                try{
                    let page = await getHTMLPage(url);
                    table = lambda(page, url, match, {});
                }
                catch(e){
                    console.log(`urt2table(${url}) in ${interval}s: ${e.message}`);
                    await fetch.sleep(interval*1000)
                    interval *= 2;
                }
            }
            return table;
        }
    }
}