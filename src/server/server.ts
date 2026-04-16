import { setHttpCallback } from '@citizenfx/http-wrapper';

import { v4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as KoaImport from 'koa';
import * as RouterImport from 'koa-router';
import * as koaBodyImport from 'koa-body';
import * as mvImport from 'mv';
import { File } from 'formidable';

const KoaCtor: any = (KoaImport as any).default || KoaImport;
const RouterCtor: any = (RouterImport as any).default || RouterImport;
const koaBodyMiddleware: any = (koaBodyImport as any).default || koaBodyImport;
const mvFunc: any = (mvImport as any).default || mvImport;

const app = new KoaCtor();
const router = new RouterCtor();
const Utimeout = 30000; // ms
const maxsize = 10 * 1024 * 1024; // 10mb
const Rroot = path.resolve(GetResourcePath(GetCurrentResourceName()));

interface UploadData {
    fileName: string;
    cb: (err: string | boolean, data: string) => void;
    timestamp: number;
}

const uploads: { [token: string]: UploadData } = {};

function resolveTargetPath(fileName: string): string | null {
    if (!fileName || typeof fileName !== 'string') {
        return null;
    }

    const normalized = path.normalize(fileName).replace(/^([/\\])+/, '');
    const resolved = path.resolve(Rroot, normalized);
    const relative = path.relative(Rroot, resolved);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return null;
    }

    return resolved;
}

// delete expired uploads in time
setInterval(() => {
    const now = Date.now();
    for (const [token, data] of Object.entries(uploads)) {
        if (now - data.timestamp > Utimeout) {
            data.cb('Upload timeout', '');
            delete uploads[token];
        }
    }
}, 10000);

router.post('/upload/:token', async (ctx) => {
    const tkn: string = ctx.params['token'];

    ctx.response.append('Access-Control-Allow-Origin', '*');
    ctx.response.append('Access-Control-Allow-Methods', 'GET, POST');

    const upload = uploads[tkn];
    if (!upload) {
        ctx.status = 400;
        ctx.body = { success: false, error: 'Invalid token' };
        return;
    }

    delete uploads[tkn];

    const finish = (err: string | false, data: string) => {
        setImmediate(() => {
            upload.cb(err || false, data);
        });
    };

    const requestFiles = (<any>ctx.request).files;
    const file = requestFiles && (requestFiles['file'] as File);
    if (!file) {
        ctx.status = 400;
        ctx.body = { success: false, error: 'No file provided' };
        finish('No file provided', '');
        return;
    }


    let stats: fs.Stats;
    try {
        stats = fs.statSync(file.path);
    } catch (e) {
        ctx.status = 400;
        ctx.body = { success: false, error: 'Invalid upload file' };
        finish('Invalid upload file', '');
        return;
    }

    if (stats.size > maxsize) {
        fs.unlink(file.path, () => {});
        ctx.status = 413;
        ctx.body = { success: false, error: 'File too large' };
        finish('File too large', '');
        return;
    }

    const validMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!file.type || !validMimes.includes(file.type)) {
        fs.unlink(file.path, () => {});
        ctx.status = 415;
        ctx.body = { success: false, error: 'Invalid file type' };
        finish('Invalid file type', '');
        return;
    }

    if (upload.fileName) {
        const targetPath = resolveTargetPath(upload.fileName);
        if (!targetPath) {
            fs.unlink(file.path, () => {});
            ctx.status = 400;
            ctx.body = { success: false, error: 'Invalid target path' };
            finish('Invalid target path', '');
            return;
        }

        mvFunc(file.path, targetPath, { mkdirp: true }, (err: Error) => {
            if (err) {
                finish(err.message, '');
                return;
            }
            finish(false, targetPath);
        });
    } else {
        fs.readFile(file.path, (err, data) => {
            if (err) {
                finish(err.message, '');
                return;
            }

            fs.unlink(file.path, (unlinkErr) => {
                if (unlinkErr) {
                    console.warn('Failed to cleanup temp file:', unlinkErr);
                }
                finish(false, `data:${file.type};base64,${data.toString('base64')}`);
            });
        });
    }

    ctx.body = { success: true };
});

app.use(koaBodyMiddleware({
    patchKoa: true,
    multipart: true,
    formidable: {
        maxFileSize: maxsize
    }
}))
  .use(router.routes())
  .use(router.allowedMethods());

setHttpCallback(app.callback());

// Cfx stuff
const exp = (<any>global).exports;

exp('requestClientScreenshot', (player: string | number, options: any, cb: (err: string | boolean, data: string) => void) => {
    const token = v4();
    const opts = options && typeof options === 'object' ? { ...options } : {};
    const fileName = opts.fileName;
    delete opts.fileName;

    uploads[token] = {
        fileName,
        cb,
        timestamp: Date.now()
    };

    emitNet('screenshot_basic:requestScreenshot', player, opts, `/${GetCurrentResourceName()}/upload/${token}`);
});