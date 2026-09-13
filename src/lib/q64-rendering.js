import downloadBlob from './download-blob';

/** A project-wide frame buffer. Frames are snapshots, independent of later stage changes. */
class Rendering {
    constructor (runtime) {
        this.runtime = runtime;
        this.frames = [];
        this.exporting = false;
        runtime.on('PROJECT_LOADED', () => this.resetFrames());
    }
    getInfo () {
        return {
            id: 'rendering',
            name: 'Rendering',
            color1: '#855cd6',
            blocks: [
                {opcode: 'resetFrames', blockType: 'command', text: 'reset frames'},
                {opcode: 'addFrame', blockType: 'command', text: 'add frame'},
                {
                    opcode: 'exportFrames',
                    blockType: 'command',
                    text: 'export frames to mp4 name: [NAME] sound: [SOUND] framerate: [FRAMERATE]',
                    arguments: {
                        NAME: {type: 'string', defaultValue: 'frames'},
                        SOUND: {type: 'string', menu: 'sounds', defaultValue: '(no sound)'},
                        FRAMERATE: {type: 'number', defaultValue: 30}
                    }
                }
            ],
            menus: {sounds: {acceptReporters: true, items: 'getSounds'}}
        };
    }
    getSounds () {
        const target = this.runtime.getEditingTarget();
        return [{text: '(no sound)', value: '(no sound)'}].concat(target ?
            target.getSounds().map(sound => ({text: sound.name, value: sound.name})) : []);
    }
    resetFrames () {
        this.frames = [];
    }
    addFrame () {
        const renderer = this.runtime.renderer;
        renderer.draw();
        const canvas = document.createElement('canvas');
        canvas.width = this.runtime.stageWidth;
        canvas.height = this.runtime.stageHeight;
        canvas.getContext('2d').drawImage(renderer.canvas, 0, 0, canvas.width, canvas.height);
        this.frames.push(canvas);
    }
    async exportFrames (args, util) {
        if (this.exporting) return;
        let output;
        this.exporting = true;
        try {
            const framerate = Number(args.FRAMERATE);
            if (!Number.isFinite(framerate) || framerate <= 0 || framerate > 240) {
                throw new Error('Framerate must be greater than 0 and at most 240.');
            }
            const frames = this.frames.slice();
            if (!frames.length) throw new Error('Add at least one frame before exporting.');
            const {Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource, Quality} =
                await import('mediabunny');
            const canvas = document.createElement('canvas');
            // H.264 requires even dimensions; pad odd-sized stages without cropping.
            canvas.width = Math.ceil(frames[0].width / 2) * 2;
            canvas.height = Math.ceil(frames[0].height / 2) * 2;
            const context = canvas.getContext('2d');
            output = new Output({format: new Mp4OutputFormat(), target: new BufferTarget()});
            const video = new CanvasSource(canvas, {codec: 'avc', quality: new Quality('high')});
            output.addVideoTrack(video, {frameRate: framerate});
            let audio;
            let buffer;
            if (String(args.SOUND) && String(args.SOUND) !== '(no sound)') {
                const sound = util.target.getSounds().find(item => item.name === String(args.SOUND));
                const player = sound && util.target.sprite.soundBank.getSoundPlayer(sound.soundId);
                if (!player || !player.buffer) throw new Error('The selected sound is unavailable.');
                const original = player.buffer;
                // Trim the soundtrack to the video duration; shorter sounds are not looped.
                const length = Math.min(original.length, Math.ceil(frames.length / framerate * original.sampleRate));
                buffer = this.runtime.audioEngine.audioContext.createBuffer(
                    original.numberOfChannels, length, original.sampleRate
                );
                for (let channel = 0; channel < original.numberOfChannels; channel++) {
                    buffer.getChannelData(channel).set(original.getChannelData(channel).subarray(0, length));
                }
                audio = new AudioBufferSource({codec: 'aac', quality: new Quality('high')});
                output.addAudioTrack(audio);
            }
            await output.start();
            if (audio) {
                await audio.add(buffer);
                audio.close();
            }
            for (let i = 0; i < frames.length; i++) {
                context.fillStyle = '#000000';
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(frames[i], 0, 0);
                await video.add(i / framerate, 1 / framerate);
            }
            video.close();
            await output.finalize();
            const name = String(typeof args.NAME === 'undefined' ? '' : args.NAME).trim() || 'frames';
            const filename = /\.mp4$/i.test(name) ? name : `${name}.mp4`;
            downloadBlob(filename, new Blob([output.target.buffer], {type: 'video/mp4'}));
        } catch (error) {
            if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel();
            // eslint-disable-next-line no-alert
            alert(`Could not export MP4: ${error.message}`);
        } finally {
            this.exporting = false;
        }
    }
}

export default Rendering;
