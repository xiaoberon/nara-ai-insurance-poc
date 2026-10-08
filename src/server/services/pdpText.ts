const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};

/** Converts CMS HTML into the evidence corpus seen by comparison extractors. */
export function htmlToPlainText(html:string):string{
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<\/(?:p|h[1-6]|section|article|aside|li|header|footer)>/gi,'。')
    .replace(/<br\s*\/?>/gi,'。')
    .replace(/<[^>]+>/g,' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi,(_match,key:string)=>{
      if(key.startsWith('#x'))return String.fromCodePoint(Number.parseInt(key.slice(2),16));
      if(key.startsWith('#'))return String.fromCodePoint(Number.parseInt(key.slice(1),10));
      return entities[key.toLowerCase()]??`&${key};`;
    })
    .replace(/\s+/g,' ')
    .replace(/。\s*。+/g,'。')
    .trim();
}

export function pdpTextFor(productId:string,pdps:Array<{product_id:string;html:string}>):string{
  return htmlToPlainText(pdps.find((p)=>p.product_id===productId)?.html??'');
}
