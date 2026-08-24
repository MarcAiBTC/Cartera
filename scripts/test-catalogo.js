// Comprueba que los dos fondos nuevos se encuentran en el buscador de activos,
// por nombre, por ISIN y por temática, y que salen los primeros.
const fs=require('fs');const {JSDOM}=require('jsdom');
const HTML='C:/Users/Marc/Desktop/Proyectos/Inversiones/Cartera/repo/index.html';
let ok=0,ko=0;
const eq=(a,b,m)=>{ if(a===b){ok++;console.log('  ✓ '+m);} else {ko++;console.log('  ✗ '+m+' → esperado '+b+', obtenido '+a);} };

const dom=new JSDOM(fs.readFileSync(HTML,'utf8'),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://marcaibtc.github.io/Cartera/'});
const w=dom.window;
w.eval('window.__CAT=CATALOGO;window.__rank=catRank;window.__norm=catNorm;');

// Mismo criterio que el buscador: ranking >=0, ordenado por ranking.
const buscar=q=>{const n=w.__norm(q);
  return w.__CAT.map(c=>({c,r:w.__rank(c,n)})).filter(x=>x.r>=0)
          .sort((a,b)=>a.r-b.r).map(x=>x.c.n);};

console.log('Fidelity MSCI Europe Index');
eq(buscar('fidelity msci europe')[0],'Fidelity MSCI Europe Index','se encuentra escribiendo el nombre');
eq(buscar('IE00BYX5MD61')[0],'Fidelity MSCI Europe Index','se encuentra por su ISIN');
eq(buscar('europa').includes('Fidelity MSCI Europe Index'),true,'aparece buscando por temática «europa»');

console.log('UBS MSCI China All Shares');
eq(buscar('ubs msci china')[0],'UBS MSCI China All Shares','se encuentra escribiendo el nombre');
eq(buscar('LU1815002040')[0],'UBS MSCI China All Shares','se encuentra por su ISIN');
eq(buscar('china').includes('UBS MSCI China All Shares'),true,'aparece buscando por temática «china»');

console.log('\nsin romper lo de antes');
eq(buscar('fidelity msci world')[0],'Fidelity MSCI World Index','el Fidelity World sigue el primero con su búsqueda');
eq(w.__CAT.length,521,'el catálogo tiene 521 entradas');

console.log('\n'+ok+' ok · '+ko+' fallos');
process.exit(ko?1:0);
