/* Run with node --test test/q64/features.cjs. No browser or live codecs required. */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const JSZip = require('@turbowarp/jszip');
const load = (file, imports, globals = {}) => {
    const code = babel.transformSync(fs.readFileSync(file, 'utf8'), {
        babelrc: false, configFile: false,
        presets: [['@babel/preset-env', {targets: {node: 'current'}}]]
    }).code;
    const exports = {};
    vm.runInNewContext(code, {exports, require: name => {
        if (name in imports) return imports[name];
        return require(name);
    }, console, ...globals});
    return exports;
};

test('default project persists, rejects invalid replacements, and falls back after cache loss', async () => {
    let saved;
    const fallback = new Uint8Array([1, 2]);
    const api = load('src/lib/q64-default-project.js', {
        './default-project': () => [{data: fallback}]
    }, {
        Response,
        caches: {open: async () => ({
            put: async (key, response) => { saved = await response.arrayBuffer(); },
            match: async () => saved && new Response(saved)
        })}
    });
    assert.equal(await api.loadDefaultProject(), fallback);
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify({targets: [{isStage: true}]}));
    const data = await zip.generateAsync({type: 'arraybuffer'});
    await api.saveDefaultProject(data);
    assert.deepEqual(new Uint8Array(await api.loadDefaultProject()), new Uint8Array(data));
    await assert.rejects(api.saveDefaultProject(new Uint8Array([0])));
    assert.deepEqual(new Uint8Array(saved), new Uint8Array(data));
    saved = null;
    assert.equal(await api.loadDefaultProject(), fallback);
});

test('rendering snapshots stage, exports timed frames and sound, and resets', async () => {
    const timestamps = [];
    const downloads = [];
    let audioLength;
    const makeCanvas = () => ({width: 0, height: 0, getContext: () => ({drawImage () {}, fillRect () {}})});
    class Output {
        constructor (options) { this.target = options.target; }
        addVideoTrack () {}
        addAudioTrack () {}
        async start () {}
        async finalize () { this.target.buffer = new ArrayBuffer(4); }
    }
    const Rendering = load('src/lib/q64-rendering.js', {
        './download-blob': (...args) => downloads.push(args),
        mediabunny: {
            Output, Mp4OutputFormat: class {}, BufferTarget: class {}, Quality: class {},
            CanvasSource: class { async add (time, duration) { timestamps.push([time, duration]); } close () {} },
            AudioBufferSource: class { async add (buffer) { audioLength = buffer.length; } close () {} }
        }
    }, {
        document: {createElement: makeCanvas}, Blob,
        window: {devicePixelRatio: 2},
        Image: class {
            constructor () { this.width = 1920; this.height = 1080; }
            set src (uri) { assert.equal(uri, 'data:image/png;base64,snapshot'); this.onload(); }
        },
        alert: message => { throw Error(message); }
    }).default;
    const runtime = {
        on () {}, stageWidth: 640, stageHeight: 360,
        renderer: {
            requestSnapshot (callback) { queueMicrotask(() => callback('data:image/png;base64,snapshot')); },
            resize (width, height) { assert.equal(width, 960); assert.equal(height, 540); }
        },
        audioEngine: {audioContext: {createBuffer: (channels, length) => ({
            length, getChannelData: () => new Float32Array(length)
        })}}
    };
    const extension = new Rendering(runtime);
    extension.setCanvasRenderSize({WIDTH: 1920, HEIGHT: 1080});
    await extension.addFrame();
    await extension.addFrame();
    assert.notEqual(extension.frames[0], extension.frames[1]);
    assert.equal((await extension.frames[0]).width, 1920);
    const target = {
        getSounds: () => [{name: 'music', soundId: '1'}],
        sprite: {soundBank: {getSoundPlayer: () => ({buffer: {
            length: 48000, numberOfChannels: 1, sampleRate: 48000,
            getChannelData: () => new Float32Array(48000)
        }})}}
    };
    await extension.exportFrames({NAME: 'My movie', SOUND: 'music', FRAMERATE: 30}, {target});
    assert.deepEqual(timestamps, [[0, 1 / 30], [1 / 30, 1 / 30]]);
    assert.equal(audioLength, 3200);
    assert.equal(downloads[0][0], 'My movie.mp4');
    assert.equal(downloads[0][1].type, 'video/mp4');
    for (const [name, expected] of [['movie.mp4', 'movie.mp4'], ['', 'frames.mp4'], [undefined, 'frames.mp4']]) {
        await extension.exportFrames({NAME: name, SOUND: '(no sound)', FRAMERATE: 30}, {target});
        assert.equal(downloads.at(-1)[0], expected);
    }
    extension.resetFrames();
    assert.equal(extension.frames.length, 0);
});
