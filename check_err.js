const fs = require('fs');
fetch('http://localhost:3000/api/anime').then(r=>r.text()).then(html=>{
  try {
    const title = html.match(/<title>(.*?)<\/title>/);
    const head = html.match(/<h1[^>]*>(.*?)<\/h1>/);
    const info = html.match(/data-nextjs-dialog-content=\"true\"[^>]*>(.*?)<\/div>/);
    console.log("===============");
    console.log("TITLE:", title ? title[1] : null);
    console.log("H1:", head ? head[1].replace(/<[^>]+>/g,'') : null);
    console.log("INFO:", info ? info[1].replace(/<[^>]+>/g,'') : null);
    console.log("===============");
  } catch (e) {}
});
