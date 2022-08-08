
class ParagraphedDocument{
    constructor(html){
        this.originalHtml = html;
        this.template = document.createElement('template');
        this.template.innerHTML = `<p>${html.replace(/^<p>/, "").replace(/<\/p>$/,"").replace(/<br[^>]*>/g,"</p><p>")}</p>`;
        let c = 1;
        let toDel = [];
        for( let par of this ){
            if( par.innerText.trim() === '' ){
                toDel.push(par);
            }
            else{   
                par.dataset.par = `par-${c}`;
                c++;
            }
        }
        console.log("Deleting:", toDel);
        toDel.forEach(p => p.remove());
    }

    toOriginalHtml(){
        let html = "";
        for( let par of this ){
            html += par.innerHTML;
        }
        console.assert(html === this.originalHtml, "Original HTML not matching");
        return html;
    }

    [Symbol.iterator](){
        return Array.from(this.template.content.children)[Symbol.iterator]();
    }
    
    /* Fake extend array using iterator for most used methods */
    map(fn){
        return Array.from(this).map(fn);
    }
    filter(fn){
        return Array.from(this).filter(fn);
    }
    forEach(fn){
        return Array.from(this).forEach(fn);
    }
    reduce(fn, initial){
        return Array.from(this).reduce(fn, initial);
    }
    some(fn){
        return Array.from(this).some(fn);
    }
    every(fn){
        return Array.from(this).every(fn);
    }
    find(fn){
        return Array.from(this).find(fn);
    }
    findIndex(fn){
        return Array.from(this).findIndex(fn);
    }
    includes(el){
        return Array.from(this).includes(el);
    }
    indexOf(el){
        return Array.from(this).indexOf(el);
    }
    lastIndexOf(el){
        return Array.from(this).lastIndexOf(el);
    }
    slice(start, end){
        return Array.from(this).slice(start, end);
    }
    concat(...arrays){
        return Array.from(this).concat(...arrays);
    }
    join(separator){
        return Array.from(this).join(separator);
    }
    toString(){
        return Array.from(this).toString();
    }
    /* END - Fake extend array using iterator for most used methods */
}