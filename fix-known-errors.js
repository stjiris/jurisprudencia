const ECLI = require('./util/ecli');
const fixes = {
    "http://www.dgsi.pt/jtrl.nsf/33182fc732316039802565fa00497eec/9a5395430007aec6802582cf004eeeb3?OpenDocument": {".AnoECLI": "2018", "Data do Acordão": "21/06/2018"},
    "http://www.dgsi.pt/jtre.nsf/134973db04f39bf2802579bf005f080b/f0611ae129477aae8025827b002d2a47?OpenDocument": {".AnoECLI": "2018", "Data do Acordão": "10/04/2018"},
    "http://www.dgsi.pt/jtca.nsf/170589492546a7fb802575c3004c6d7d/ecf6730f98261130802571f800347524?OpenDocument": {".AnoECLI": "2006", "Data do Acordão": "26/09/2006"},
    "http://www.dgsi.pt/jtrg.nsf/86c25a698e4e7cb7802579ec004d3832/765d9792c9acf919802581ad0052038e?OpenDocument": {".AnoECLI": "2017", "Data do Acordão": "29/06/2017"},
    "http://www.dgsi.pt/jtcn.nsf/89d1c0288c2dd49c802575c8003279c7/75619824943bd597802580020032792e?OpenDocument": {".AnoECLI": "2016", "Data do Acordão": "01/07/2016"},
    "http://www.dgsi.pt/jtre.nsf/134973db04f39bf2802579bf005f080b/32227fea7dac58e4802581d900341950?OpenDocument": {".AnoECLI": "2017", "Data do Acordão": "26/10/2017"},
    "http://www.dgsi.pt/jtca.nsf/170589492546a7fb802575c3004c6d7d/f4e14249caaf440580257685005a67ad?OpenDocument": {".AnoECLI": "2009", "Data do Acordão": "03/12/2009"},
    "http://www.dgsi.pt/jtca.nsf/170589492546a7fb802575c3004c6d7d/c46ce01b55ca0f7480257760005a89fe?OpenDocument": {".AnoECLI": "2010", "Data do Acordão": "08/07/2010"},
    "http://www.dgsi.pt/jtrp.nsf/56a6e7121657f91e80257cda00381fdf/ea09f737fc55389b80257290003ba162?OpenDocument": {Relator: "PEDRO M MENEZES"},
    "https://www.tribunalconstitucional.pt/tc/acordaos/20220123.html": {Data: "03/02/2022"},
    "http://www.dgsi.pt/jsta.nsf/35fbbbf22e1bb1e680256f8e003ea931/cabeb77f930887af8025703e003a0749?OpenDocument": {"Data de Entrada": "11/04/2005"},
    "http://www.dgsi.pt/jsta.nsf/35fbbbf22e1bb1e680256f8e003ea931/f88e2af28794ae1b80256dbb004ad523?OpenDocument": {"Data de Entrada": "08/05/2003"},
    "http://www.dgsi.pt/jsta.nsf/35fbbbf22e1bb1e680256f8e003ea931/575daa64107a9f4b802570300034ed89?OpenDocument": {"Data de Entrada": "22/02/2005"},
    "http://www.dgsi.pt/jsta.nsf/35fbbbf22e1bb1e680256f8e003ea931/62844d4e5ccde6dc802572840038634f?OpenDocument": {"Data de Entrada": "03/05/2006"},
    "http://www.dgsi.pt/jsta.nsf/35fbbbf22e1bb1e680256f8e003ea931/90fcf58140e44d4380256c3f00346a67?OpenDocument": {"Data de Entrada": "09/05/2001"},
    "http://www.dgsi.pt/jstj.nsf/954f0ce6ad9dd8b980256b5f003fa814/4d1d3794386074c180256c67003902dc?OpenDocument": {".AnoECLI": "2002", Data: "23/10/2000"},
    "http://www.dgsi.pt/jstj.nsf/954f0ce6ad9dd8b980256b5f003fa814/d07afeb1efb1f57b80256f9a0030b70f?OpenDocument": {Data: "31/01/2004"},
    "http://www.dgsi.pt/jsta.nsf/35fbbbf22e1bb1e680256f8e003ea931/89f5178f7d862649802581ad005396a0?OpenDocument": {"Data de Entrada": "07/02/2007"},
    "http://www.dgsi.pt/jtrp.nsf/56a6e7121657f91e80257cda00381fdf/54b1486f58d8ea1c8025689d0037e02a?OpenDocument": {"Data Dec. Recorrida":"01/09/2000"},
    "http://www.dgsi.pt/jtrp.nsf/56a6e7121657f91e80257cda00381fdf/c1e6234a8ec15e8c802568f90032fa0b?OpenDocument": {"Data Dec. Recorrida":"01/06/2000"},
    "http://www.dgsi.pt/jstj.nsf/954f0ce6ad9dd8b980256b5f003fa814/04a08ae5d098fc6680256d5d0026a72d?OpenDocument": {Data: "02/07/2002"},
    "http://www.dgsi.pt/jstj.nsf/954f0ce6ad9dd8b980256b5f003fa814/6eddecdd42f8275880256a420038a615?OpenDocument": {Data: "01/07/1998"}
}

module.exports = (jsonBody) => {
    let res = {};
    for( let key in jsonBody){
        res[key] = jsonBody[key];
        if( key == "Relator" ){
            res[key] = res[key].replace(/\s{2,10}/g, " ").replace(/\./g, "").trim(); // Remove dots and spaces
        }
    }
    let link = jsonBody["Original URL"];
    if( fixes[link] ){
        console.log("Fixing", link);
        for( let key in fixes[link]){
            if( !key.startsWith(".") ){
                res[key] = fixes[link][key];
            }
        }
        if( ".AnoECLI" in fixes[link] ){
            res.ECLI = ECLI.fromString(jsonBody.ECLI).setYear(fixes[link][".AnoECLI"]).build();
        }
    }
    return res;
}

module.exports.fixes = Object.keys(fixes);