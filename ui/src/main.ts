import {
    OrthographicCamera,
    Scene,
    WebGLRenderTarget,
    LinearFilter,
    NearestFilter,
    RGBAFormat,
    UnsignedByteType,
    CfxTexture,
    ShaderMaterial,
    PlaneBufferGeometry,
    Mesh,
    WebGLRenderer
} from '@citizenfx/three';

class ScreenshotRequest {
    encoding: 'jpg' | 'png' | 'webp';
    quality: number;
    headers: any;

    correlation: string;

    resultURL: string;

    targetURL: string;
    targetField: string;
}

// from https://stackoverflow.com/a/12300351
function dataURItoBlob(dataURI: string) {
    const parts = dataURI.split(',');
    const byteString = atob(parts[1] || '');
    const mimeString = (parts[0] || '').split(':')[1].split(';')[0] || 'application/octet-stream';

    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
  
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
  
    const blob = new Blob([ab], {type: mimeString});
    return blob;
}

class ScreenshotUI {
    renderer: any;
    rtTexture: any;
    sceneRTT: any;
    cameraRTT: any;
    material: any;
    request: ScreenshotRequest;

    initialize() {
        window.addEventListener('message', event => {
            if (!event.data || !event.data.request) {
                return;
            }

            this.request = this.normalizeRequest(event.data.request);
        });

        window.addEventListener('resize', () => {
            this.resize();
        });

        const cameraRTT: any = new OrthographicCamera( window.innerWidth / -2, window.innerWidth / 2, window.innerHeight / 2, window.innerHeight / -2, -10000, 10000 );
        cameraRTT.position.z = 100;

        const sceneRTT: any = new Scene();

        const rtTexture = new WebGLRenderTarget( window.innerWidth, window.innerHeight, { minFilter: LinearFilter, magFilter: NearestFilter, format: RGBAFormat, type: UnsignedByteType } );
        const gameTexture: any = new (CfxTexture as any)();
        gameTexture.needsUpdate = true;

        const material = new ShaderMaterial( {

            uniforms: { "tDiffuse": { value: gameTexture } },
            vertexShader: `
			varying vec2 vUv;

			void main() {
				vUv = vec2(uv.x, 1.0-uv.y); // fuck gl uv coords
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}
`,
            fragmentShader: `
			varying vec2 vUv;
			uniform sampler2D tDiffuse;

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );
			}
`

        } );

        this.material = material;

        const plane = new PlaneBufferGeometry( window.innerWidth, window.innerHeight, 1, 1 );
        const quad: any = new Mesh( plane, material );
        quad.position.z = -100;
        sceneRTT.add( quad );

        const renderer: any = new (WebGLRenderer as any)();
        renderer.setPixelRatio( window.devicePixelRatio );
        renderer.setSize( window.innerWidth, window.innerHeight );
        renderer.autoClear = false;

        document.getElementById('app').appendChild(renderer.domElement);
        document.getElementById('app').style.display = 'none';

        this.renderer = renderer;
        this.rtTexture = rtTexture;
        this.sceneRTT = sceneRTT;
        this.cameraRTT = cameraRTT;

        this.animate = this.animate.bind(this);

        requestAnimationFrame(this.animate);
    }

    private normalizeRequest(raw: any): ScreenshotRequest {
        const encoding = raw && (raw.encoding === 'jpg' || raw.encoding === 'png' || raw.encoding === 'webp')
            ? raw.encoding
            : 'jpg';
        const quality = raw && typeof raw.quality === 'number' ? raw.quality : 0.92;
        const headers = raw && typeof raw.headers === 'object' && raw.headers !== null ? raw.headers : {};

        return {
            ...raw,
            encoding,
            quality,
            headers,
            correlation: raw && raw.correlation ? String(raw.correlation) : '',
            resultURL: raw && raw.resultURL ? String(raw.resultURL) : null,
            targetURL: raw && raw.targetURL ? String(raw.targetURL) : '',
            targetField: raw && raw.targetField ? String(raw.targetField) : null
        };
    }

    private sendResult(request: ScreenshotRequest, data: string): Promise<void> {
        if (!request.resultURL) {
            return Promise.resolve();
        }

        return fetch(request.resultURL, {
            method: 'POST',
            mode: 'cors',
            body: JSON.stringify({
                data,
                id: request.correlation
            })
        }).then(() => undefined);
    }

    resize() {
        if (this.rtTexture) {
            this.rtTexture.dispose();
        }

        const cameraRTT: any = new OrthographicCamera(
            window.innerWidth / -2,
            window.innerWidth / 2,
            window.innerHeight / 2,
            window.innerHeight / -2,
            -10000,
            10000
        );
        cameraRTT.position.z = 100;
        this.cameraRTT = cameraRTT;

        const sceneRTT: any = new Scene();
        const plane = new PlaneBufferGeometry( window.innerWidth, window.innerHeight, 1, 1 );
        const quad: any = new Mesh( plane, this.material );
        quad.position.z = -100;
        sceneRTT.add( quad );
        this.sceneRTT = sceneRTT;

        this.rtTexture = new WebGLRenderTarget(
            window.innerWidth,
            window.innerHeight,
            { minFilter: LinearFilter, magFilter: NearestFilter, format: RGBAFormat, type: UnsignedByteType }
        );
        this.renderer.setSize( window.innerWidth, window.innerHeight );
    }

    animate() {
        requestAnimationFrame(this.animate);

        this.renderer.clear();
        (this.renderer as any).render(this.sceneRTT, this.cameraRTT, this.rtTexture, true);

        if (this.request) {
            const request = this.request;
            this.request = null;

            this.handleRequest(request);
        }
    }

    handleRequest(request: ScreenshotRequest) {
        try {
            if (!request.targetURL) {
                this.sendResult(request, '').catch(err => {
                    console.error('Result callback failed:', err);
                });
                return;
            }

            // read the screenshot
            const read = new Uint8Array(window.innerWidth * window.innerHeight * 4);
            this.renderer.readRenderTargetPixels(this.rtTexture, 0, 0, window.innerWidth, window.innerHeight, read);

            // create a temporary canvas to compress the image
            const canvas = document.createElement('canvas');
            canvas.style.display = 'inline';
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;

            // get 2d context with null check
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                console.error('Failed to get canvas 2d context');
                this.sendResult(request, '').catch(err => {
                    console.error('Result callback failed:', err);
                });
                return;
            }

            // draw the image on the canvas
            const d = new Uint8ClampedArray(read.buffer);
            ctx.putImageData(new ImageData(d, window.innerWidth, window.innerHeight), 0, 0);

            // encode the image with proper type
            const quality = request.quality || 0.92;
            const mimeType = {
                jpg: 'image/jpeg',
                png: 'image/png',
                webp: 'image/webp'
            }[request.encoding] || 'image/png';

            const imageURL = canvas.toDataURL(mimeType, quality);

            // Upload the image
            const uploadImage = () => {
                const headers = request.headers || {};
                const body = request.targetField
                    ? this.getFormData(imageURL, request)
                    : JSON.stringify({
                        data: imageURL,
                        id: request.correlation
                    });

                fetch(request.targetURL, {
                    method: 'POST',
                    mode: 'cors',
                    headers,
                    body
                })
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`Upload failed: ${response.status}`);
                        }
                        return response.text();
                    })
                    .then(text => {
                        return this.sendResult(request, text);
                    })
                    .catch(err => {
                        console.error('Screenshot upload failed:', err);
                        return this.sendResult(request, '');
                    })
                    .catch(err => {
                        console.error('Result callback failed:', err);
                    });
            };

            uploadImage();
        } catch (err) {
            console.error('Screenshot processing error:', err);
            this.sendResult(request, '').catch(sendErr => {
                console.error('Result callback failed:', sendErr);
            });
        }
    }

    private getFormData(imageURL: string, request: ScreenshotRequest): FormData {
        const formData = new FormData();
        const blob = dataURItoBlob(imageURL);
        formData.append(request.targetField, blob, `screenshot.${request.encoding}`);
        return formData;
    }
}

const ui = new ScreenshotUI();
ui.initialize();