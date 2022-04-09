const fetch = require('./util/fetch.js');
const { Worker } = require("worker_threads")
const { init } = require("./indexer")


console.log("This process will crawl through all the dgsi databases and insert each process in the current elastic search instance.")
console.log("Finding relevant courts databases from www.dgsi.pt...")

init().then( async _ => {
    let dom = await fetch.dom("http://www.dgsi.pt/");
    let links = dom.window.document.querySelectorAll("a")
    for( let l of links){
        let m = l.href.match(/http:\/\/www.dgsi.pt\/(?<trib_acron>[^/]*)\.nsf\?OpenDatabase$/) 
        if( m && l.textContent.match("Acórdãos")){
            let Tribunal = l.textContent.substr("Acórdãos do".length).replace("(até 1998)", "").trim() // Importação de acórdãos do Tribunal Constitucional
            let TribunalCode = m.groups.trib_acron.substr(1,3).toUpperCase()
            
            new Worker("./dgsi-indexer-worker.js", {workerData: {
                Tribunal: Tribunal,
                TribunalCode: TribunalCode,
                link : l.href
            }});
        }    
    }
}).catch(e => {
    console.log(e)
})