const cors = (request, env) => {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGIN;
  if (origin !== allowed) return null;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
};

const json = (data, status, corsHeaders) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });

function xmlEscape(value) {
  return value.replace(/[<>&"']/g, c => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;"
  })[c]);
}
function xmlUnescape(value) {
  return value.replace(/&(lt|gt|amp|quot|apos);/g, (_, k) =>
    ({lt:"<",gt:">",amp:"&",quot:'"',apos:"'"}[k]));
}
function parseStory(xml) {
  const get = tag => {
    const match = xml.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"));
    return match ? xmlUnescape(match[1]) : "";
  };
  return { id:get("id"), text:get("text"), tag:get("tag"), date:Number(get("date")) || 0, likes:0 };
}
async function github(path, env, options = {}) {
  return fetch("https://api.github.com/repos/" + env.GITHUB_OWNER + "/" +
    env.GITHUB_REPO + "/contents/" + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + env.GITHUB_TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

export default {
  async fetch(request, env) {
    const headers = cors(request, env);
    if (!headers) return new Response("Origin not allowed", { status: 403 });
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (url.pathname === "/stories" && request.method === "GET") {
      const listing = await github("stories", env);
      if (!listing.ok) return json({error:"Could not list stories"}, 502, headers);
      const files = (await listing.json()).filter(x => x.type === "file" && x.name.endsWith(".xml"));
      const stories = await Promise.all(files.slice(0, 100).map(async file => {
        const result = await fetch(file.download_url);
        if (!result.ok) return null;
        return parseStory(await result.text());
      }));
      return json(stories.filter(s => s && s.id && s.text), 200, headers);
    }
    if (url.pathname === "/stories" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({error:"Invalid JSON"},400,headers); }
      const text = String(body.text || "").trim();
      const tag = ["Мысли","Радость","Поддержка"].includes(body.tag) ? body.tag : "Мысли";
      if (!text || text.length > 500) return json({error:"Story must be 1–500 characters"},400,headers);
      const id = crypto.randomUUID();
      const date = Date.now();
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<story><id>' + id + '</id><text>' + xmlEscape(text) +
        '</text><tag>' + tag + '</tag><date>' + date + '</date></story>\n';
      const bytes = new TextEncoder().encode(xml);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const content = btoa(binary);
      const saved = await github("stories/" + id + ".xml", env, {
        method:"PUT",
        body:JSON.stringify({message:"Add anonymous story " + id, content})
      });
      if (!saved.ok) return json({error:"GitHub could not save the story"},502,headers);
      return json({success:true,story:{id,text,tag,date,likes:0}},201,headers);
    }
    return json({error:"Not found"},404,headers);
  }
};
