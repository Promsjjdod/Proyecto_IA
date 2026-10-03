import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config/env.js';
import { parse, idSchema, imageGenSchema, videoGenSchema } from '../core/validate.js';
import { badRequest, notFound } from '../core/errors.js';
import * as images from '../services/image.service.js';
import * as videos from '../services/video.service.js';

export const mediaRoutes = Router();

// ------------------------------------------------------------------- images
mediaRoutes.get('/images/status', (_req, res) => {
  res.json(images.imageProviderStatus());
});

mediaRoutes.get('/images', (_req, res) => {
  res.json({ images: images.listImages(), status: images.imageProviderStatus() });
});

mediaRoutes.post('/images', async (req, res) => {
  const body = parse(imageGenSchema, req.body, 'image request');
  const rows = await images.generateImages(body);
  res.status(201).json({ images: rows });
});

mediaRoutes.post('/images/:id/regenerate', async (req, res) => {
  const id = parse(idSchema, req.params.id, 'image id');
  const original = images.get(id);
  const rows = await images.generateImages({
    prompt: original.prompt,
    negativePrompt: original.negativePrompt,
    aspect: original.aspect,
    resolution: original.resolution,
    count: 1,
    style: original.style,
  });
  res.status(201).json({ images: rows });
});

mediaRoutes.get('/images/:id/content', (req, res) => {
  const id = parse(idSchema, req.params.id, 'image id');
  const row = images.get(id);
  const abs = images.absoluteImagePath(row);
  if (!fs.existsSync(abs)) throw notFound('Image file missing on disk.');
  const ext = path.extname(abs).toLowerCase();
  res.setHeader('Content-Type', ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png');
  fs.createReadStream(abs).pipe(res);
});

mediaRoutes.delete('/images/:id', (req, res) => {
  const id = parse(idSchema, req.params.id, 'image id');
  images.removeImage(id);
  res.json({ ok: true });
});

// ------------------------------------------------------------------- videos
mediaRoutes.get('/videos/status', (_req, res) => {
  res.json(videos.videoProviderStatus());
});

mediaRoutes.get('/videos', (_req, res) => {
  res.json({ videos: videos.listVideos(), status: videos.videoProviderStatus() });
});

mediaRoutes.post('/videos', (req, res) => {
  const body = parse(videoGenSchema, req.body, 'video request');
  res.status(201).json({ video: videos.enqueueVideo(body) });
});

mediaRoutes.delete('/videos/:id', (req, res) => {
  const id = parse(idSchema, req.params.id, 'video id');
  videos.remove(id);
  res.json({ ok: true });
});

mediaRoutes.get('/videos/:id/content', (req, res) => {
  const id = parse(idSchema, req.params.id, 'video id');
  const row = videos.get(id);
  if (!row.path || !fs.existsSync(row.path)) throw notFound('Video file not available yet.');
  res.setHeader('Content-Type', 'video/mp4');
  fs.createReadStream(row.path).pipe(res);
});
