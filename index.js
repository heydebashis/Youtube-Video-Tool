import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import path from "path";

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());
app.use(express.static(path.join(process.cwd(), "public")));

// yt-dlp for stream URL
function getStreamUrl(videoUrl) {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", ["-f", "best[ext=mp4]", "-g", videoUrl]);
    let out = "";
    proc.stdout.on("data", d => (out += d));
    proc.stderr.on("data", d => console.error("yt-dlp stderr:", d.toString()));
    proc.on("close", code => {
      if(code!==0) return reject(new Error(`yt-dlp exited ${code}`));
      const url = out.trim().split("\n")[0];
      if(!url) return reject(new Error("No URL from yt-dlp"));
      resolve(url);
    });
  });
}

function parseTimestamp(ts) {
  const [m=0, s=0] = ts.split(":").map(Number);
  return m*60 + s;
}

// Endpoint: cut preview
app.get("/cut", async (req, res) => {
  const {
    url, timestamp, duration, maxsize, unit, resolution, includeAudio="off"
  } = req.query;

  if(!url||!timestamp||!duration||!maxsize||!unit||!resolution){
    return res.status(400)
      .send("Missing one of url, timestamp, duration, maxsize, unit or resolution");
  }

  // 1) get direct stream
  let streamUrl;
  try {
    streamUrl = await getStreamUrl(url);
  } catch(err){
    console.error("yt-dlp error:", err);
    return res.status(500).send("Failed to fetch video URL: "+err.message);
  }

  // 2) calculate target bitrates
  const clipDur = Math.max(1, +duration);
  const sizeBytes = parseFloat(maxsize) * (unit==="MB"?1024*1024:1024);
  const videoKbps = Math.floor((sizeBytes*8)/(clipDur*1000));
  console.log(`→ video kbps: ${videoKbps}`);

  const heights = { "360":360, "480":480, "720":720, "1080":1080 };
  const height = heights[resolution]||360;
  const wantAudio = includeAudio==="on";
  console.log("→ include audio?", wantAudio);

  // 3) headers
  res.setHeader("Content-Type","video/mp4");
  res.setHeader('Content-Disposition','attachment; filename="preview.mp4"');

  // 4) build ffmpeg
  let cmd = ffmpeg(streamUrl)
    .inputOptions("-timeout 3000000")
    .seekInput(parseTimestamp(timestamp))
    .duration(clipDur)
    .videoBitrate(videoKbps)
    .videoFilters(`scale=-2:${height}`)
    .outputOptions("-movflags","frag_keyframe+empty_moov+default_base_moof")
    .format("mp4");

  if(wantAudio){
    cmd = cmd
      .audioCodec("aac")
      .audioFrequency(44100)
      .audioChannels(1)
      .audioBitrate("64k");
  } else {
    cmd = cmd.noAudio();
  }

  cmd.on("start", c => console.log("FFmpeg:", c))
     .on("stderr", l => console.error(l))
     .on("error", (err,_,stderr) => {
       console.error("FFmpeg error:", err, stderr);
       if(!res.headersSent) res.status(500).send(stderr);
     })
     .pipe(res, { end:true });
});

// Endpoint: download original
app.get("/download-original", (req, res) => {
  const { url } = req.query;
  if(!url) return res.status(400).send("Missing url");
  res.setHeader("Content-Type","video/mp4");
  res.setHeader('Content-Disposition','attachment; filename="video.mp4"');

  const proc = spawn("yt-dlp", [
    "-f","best[ext=mp4]","-o","-","--no-part","--no-cache-dir",url
  ]);
  proc.stdout.pipe(res);
  proc.stderr.on("data", d => console.error("yt-dlp stderr:", d.toString()));
  proc.on("close", code => {
    if(code!==0 && !res.headersSent){
      res.status(500).end("Download failed");
    }
  });
});

const PORT = process.env.PORT||3000;
app.listen(PORT, ()=>console.log(`Listening on http://localhost:${PORT}`));
