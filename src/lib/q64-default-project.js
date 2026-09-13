import JSZip from '@turbowarp/jszip';
import defaultProject from './default-project';

const CACHE_NAME = 'q64-default-project-v1';
const CACHE_KEY = '/q64-default-project.sb3';

const validateProject = async data => {
    const zip = await JSZip.loadAsync(data);
    const entry = zip.file('project.json');
    if (!entry) throw new Error('Please choose a Scratch 3 (.sb3) project.');
    const project = JSON.parse(await entry.async('string'));
    if (!Array.isArray(project.targets) || !project.targets.some(target => target.isStage)) {
        throw new Error('The file does not contain a valid Scratch stage.');
    }
};

export const loadDefaultProject = async () => {
    try {
        const cache = await caches.open(CACHE_NAME);
        const response = await cache.match(CACHE_KEY);
        if (response) {
            const data = await response.arrayBuffer();
            await validateProject(data);
            return data;
        }
    } catch (error) {
        // Storage may be unavailable or cleared. The bundled engine always remains usable.
        console.warn('Could not read the saved default project', error);
    }
    return defaultProject()[0].data;
};

export const saveDefaultProject = async data => {
    await validateProject(data);
    const cache = await caches.open(CACHE_NAME);
    await cache.put(CACHE_KEY, new Response(data, {headers: {'Content-Type': 'application/octet-stream'}}));
};

export const chooseDefaultProject = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.sb3';
    input.onchange = async () => {
        if (!input.files.length) return;
        try {
            await saveDefaultProject(await input.files[0].arrayBuffer());
            // eslint-disable-next-line no-alert
            alert('Default project saved. It will be used on startup and when creating a new project.');
        } catch (error) {
            // eslint-disable-next-line no-alert
            alert(`Could not save the default project: ${error.message}`);
        }
    };
    input.click();
};
