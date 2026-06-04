import { Router } from 'express';

/**
 * Tile Proxy with Imagery Age Enforcement
 * 
 * This module provides a proxy for map tiles that ensures no imagery older 
 * than a specified threshold is served.
 * 
 * Logic:
 * 1. Intercept tile request (z/y/x).
 * 2. Query Esri metadata for that tile's area.
 * 3. If imagery is newer than maxAge, stream the tile.
 * 4. If imagery is too old, return 404.
 * 5. Leaflet will automatically "overzoom" (stretch) the last valid 
 *    lower-zoom tile when it receives a 404 for a higher zoom.
 */

const router = Router();

const METADATA_URL = 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/0/query';
const TILE_SOURCE_URL = 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile';
const DEFAULT_MAX_AGE_YEARS = 3;

const metadataCache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

function tileToBBox(z, x, y) {
    const n = Math.pow(2, z);
    const west = (x / n) * 360 - 180;
    const east = ((x + 1) / n) * 360 - 180;
    const latRad = (y) => {
        const n_rad = Math.PI - (2 * Math.PI * y) / n;
        return Math.atan(0.5 * (Math.exp(n_rad) - Math.exp(-n_rad)));
    };
    const north = latRad(y) * (180 / Math.PI);
    const south = latRad(y + 1) * (180 / Math.PI);
    return { west, south, east, north };
}

async function getImageryCaptureDate(z, x, y) {
    const cacheKey = `${z}/${x}/${y}`;
    const cached = metadataCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        return cached.date;
    }

    const bbox = tileToBBox(z, x, y);
    const params = new URLSearchParams({
        f: 'json',
        geometryType: 'esriGeometryEnvelope',
        geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'src_date',
        returnGeometry: 'false'
    });

    try {
        const response = await fetch(`${METADATA_URL}?${params.toString()}`);
        const data = await response.json();
        let newest = 0;
        if (data.features) {
            for (const f of data.features) {
                if (f.attributes.src_date > newest) newest = f.attributes.src_date;
            }
        }
        const date = newest ? new Date(newest) : null;
        metadataCache.set(cacheKey, { date, timestamp: Date.now() });
        return date;
    } catch (err) {
        return null; 
    }
}

router.get('/:z/:y/:x', async (req, res) => {
    const { z, y, x } = req.params;
    const maxAgeYears = parseInt(req.query.maxAge, 10) || DEFAULT_MAX_AGE_YEARS;

    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - maxAgeYears);

    const captureDate = await getImageryCaptureDate(parseInt(z, 10), parseInt(x, 10), parseInt(y, 10));

    // If imagery is too old, return 404 to trigger client-side overzoom
    if (captureDate && captureDate < cutoffDate) {
        console.log(`[TileProxy] Blocking old tile ${z}/${y}/${x} (${captureDate.toISOString()})`);
        return res.status(404).send('Imagery too old');
    }

    // Otherwise, proxy the tile
    try {
        const tileRes = await fetch(`${TILE_SOURCE_URL}/${z}/${y}/${x}`);
        if (!tileRes.ok) return res.status(tileRes.status).send();
        
        res.set('Content-Type', tileRes.headers.get('Content-Type'));
        res.set('Cache-Control', 'public, max-age=86400');
        
        const buffer = await tileRes.arrayBuffer();
        return res.send(Buffer.from(buffer));
    } catch (err) {
        return res.status(502).json({ error: 'Source fetch failed' });
    }
});

export default router;
