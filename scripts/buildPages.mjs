/*
 * Copyright 2024 The Ray Optics Simulation authors and contributors
 * Modified in the Wave Optics Simulation, a fork of https://github.com/ricktu288/ray-optics
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EXAMPLE_SCENES } from '../src/waveApp/exampleScenes.js';
import Handlebars from 'handlebars';
import { marked } from 'marked';
import i18next from 'i18next';
import simpleGit from 'simple-git';

// Check for --release flag
const isRelease = process.argv.includes('--release');

// Convert import.meta.url to a file path and determine the directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Copy the third-party libraries used by the non-app pages to the /dist/thirdparty folder
fs.mkdirSync(path.join(__dirname, '../dist/thirdparty'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '../node_modules/jquery/dist/jquery.min.js'), path.join(__dirname, '../dist/thirdparty/jquery.min.js'));
fs.mkdirSync(path.join(__dirname, '../dist/thirdparty/bootstrap'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '../node_modules/bootstrap3/dist/css/bootstrap.min.css'), path.join(__dirname, '../dist/thirdparty/bootstrap/bootstrap.min.css'));
fs.copyFileSync(path.join(__dirname, '../node_modules/bootstrap3/dist/js/bootstrap.min.js'), path.join(__dirname, '../dist/thirdparty/bootstrap/bootstrap.min.js'));
fs.mkdirSync(path.join(__dirname, '../dist/thirdparty/fonts'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '../node_modules/bootstrap3/dist/fonts/glyphicons-halflings-regular.woff2'), path.join(__dirname, '../dist/thirdparty/fonts/glyphicons-halflings-regular.woff2'));
fs.mkdirSync(path.join(__dirname, '../dist/thirdparty/mathjax'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '../node_modules/mathjax/es5/tex-mml-chtml.js'), path.join(__dirname, '../dist/thirdparty/mathjax/tex-mml-chtml.js'));
fs.cpSync(
  path.join(__dirname, '../node_modules/mathjax/es5/output/chtml/fonts'),
  path.join(__dirname, '../dist/thirdparty/mathjax/output/chtml/fonts'),
  { recursive: true }
);




// List all existing languages, which are the directories in the /locales directory. Put English first.
const langs = ['en'].concat(fs.readdirSync(path.join(__dirname, '../locales')).filter((file) => !file.includes('.') && file !== 'en'));

// Load the locale routes data
const routesData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/localeRoutes.json'), 'utf8'));

// Fill the rest of the locale rountes
for (const lang of langs) {
  if (routesData[lang] === undefined) {
    routesData[lang] = '/' + lang;
  }
}


// Load and process contributors data
const git = simpleGit();
const contributors = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/contributors.json'), 'utf8'));

// Initialize commit counts
contributors.forEach(c => c.commits = 0);

// Get Git contributors
const logEntries = await git.raw([
  'log',
  '--reverse',
  '--pretty=format:%H|%an|%ae|%aI|%s|%P'
]);

const firstEntryHash = logEntries.split('\n')[0].split('|')[0];

if (firstEntryHash !== 'c3b4eea281d34fc2aee5186510cceb50cd9db2f5') {
  console.log('The repo is not completely cloned. Cannot generate contributors list.');
  process.exit(1);
}

// Process git log entries
logEntries.split('\n').forEach(entry => {
  const [hash, name, email, date, message, parents] = entry.split('|');

  if (!name || !email || !date) {
    console.warn('Skipping invalid log entry:', entry);
    return;
  }

  // Rule out merge commits
  const parentCount = parents.split(' ').filter(Boolean).length;
  if (parentCount > 1) {
    return;
  }

  const contributor = contributors.find(c => (c.githubEmails || []).includes(email));
  if (contributor) {
    contributor.commits += 1;
  }
});

// Sort contributors by commit count
const sortedContributors = contributors
  .filter(c => !c.isMainAuthor)
  .sort((a, b) => b.commits - a.commits);
const sortedMainAuthors = contributors
  .filter(c => c.isMainAuthor)
  .sort((a, b) => b.commits - a.commits);




// Load the module list
const moduleList = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/moduleList.json'), 'utf8'));

// Load the English module data
const moduleData = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/en/modules.json'), 'utf8')).moduleData;

// Create a dictionary mapping the module IDs to the array of control point sequence keys and parameters keys
const moduleControlPointSequenceKeys = {};
const moduleParametersKeys = {};
for (const id in moduleData) {
  // Load the module scene data
  const moduleSceneData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/moduleScenes', id + '.json'), 'utf8'));
  const moduleDef = moduleSceneData.modules[id];
  const numPoints = moduleDef.numPoints;
  moduleControlPointSequenceKeys[id] = [];
  moduleParametersKeys[id] = {};
  for (let i = 1; i <= numPoints; i++) {
    moduleControlPointSequenceKeys[id].push(`modules:moduleData.${id}.point${i}`);
  }
  for (const param of moduleDef.params) {
    const paramName = param.split('=')[0];
    moduleParametersKeys[id][paramName] = `modules:moduleData.${id}.${paramName.replace(/_/g, '')}`;
  }
}

// List all module ids in the moduleList
const moduleIDs = [];
for (const category of moduleList) {
  for (const item of category.content) {
    moduleIDs.push(item.id);
  }
}


// Given a json object, calculate the total number of strings in the object, but string keys of the form key_suffix are treated as the same string as key.
/**
 * The home page's wave-optics sections. Each reads its text from the locale
 * data and its pictures from `src/img/wave`, which are renders of the real app
 * produced by `scripts/buildWaveImages.mjs`.
 */

/** Which examples head the carousel, in order. */
const WAVE_CAROUSEL = ['twoPointSources', 'zonePlate', 'lens', 'grating', 'fiveSlits'];

/** The examples shown as a strip at the foot of the home page. */
const WAVE_EXAMPLE_STRIP = [
  'twoPointSources', 'doubleSlit', 'grating', 'zonePlate', 'lens', 'farField',
];

/** The tool types listed under each component category. */
const WAVE_CATEGORY_TOOLS = {
  sources: ['WavePointSource', 'WaveLineSource', 'WavePlaneWave'],
  interfaces: [
    'WaveInterface', 'WaveLens', 'WaveMultiSlit', 'WaveSquareGrating',
    'WaveSinusoidalGrating', 'WaveZonePlate', 'WaveBinaryMask',
  ],
  measure: ['WaveScreen', 'WaveFocusProbe'],
};

/** The three ways the field can be shown, matching the app's view buttons. */
const WAVE_VIEWS = ['intensity', 'field', 'amplitudePhase'];

const waveExampleName = (id) =>
  EXAMPLE_SCENES.find((example) => example.id === id)?.name ?? id;

function waveCarousel(rootUrl, waveUrl) {
  return WAVE_CAROUSEL.map((id) => ({
    name: waveExampleName(id),
    image: `${rootUrl}/img/wave/carousel-${id}.jpg`,
    url: `${waveUrl}#${id}`,
  }));
}

function waveExampleStrip(rootUrl, waveUrl) {
  return WAVE_EXAMPLE_STRIP.map((id) => ({
    name: waveExampleName(id),
    image: `${rootUrl}/img/wave/thumbnail-${id}.jpg`,
    url: `${waveUrl}#${id}`,
  }));
}

function waveCategories(rootUrl) {
  return Object.entries(WAVE_CATEGORY_TOOLS).map(([category, tools]) => ({
    title: i18next.t(`main:waveHomePage.categories.${category}.title`),
    description: i18next.t(`main:waveHomePage.categories.${category}.description`),
    image: `${rootUrl}/img/wave/category-${category}.jpg`,
    tools: tools.map((type) => ({
      title: i18next.t(`main:waveTools.${type}.title`),
      description: i18next.t(`main:waveTools.${type}.description`),
      image: `${rootUrl}/img/wave/tool-${type}.jpg`,
    })),
  }));
}

function waveViews(rootUrl) {
  return WAVE_VIEWS.map((view) => ({
    title: i18next.t(`main:waveHomePage.views.${view}.title`),
    description: i18next.t(`main:waveHomePage.views.${view}.description`),
    image: `${rootUrl}/img/wave/view-${view}.jpg`,
  }));
}

function countStrings(json) {
  const stringKeys = new Set();
  let count = 0;
  for (const key in json) {
    if (typeof json[key] === 'string') {
      if (key.includes('_')) {
        stringKeys.add(key.split('_')[0]);
      } else {
        stringKeys.add(key);
      }
    } else if (typeof json[key] === 'object') {
      count += countStrings(json[key]);
    }
  }
  return count + stringKeys.size;
}

const homeLangs = [];
const aboutLangs = [];
/**
 * Shorten a sentence to fit a caption, cutting at the last word that fits.
 * @param {string} text
 * @param {number} limit - The longest the result may be, the ellipsis included.
 * @returns {string}
 */
function shorten(text, limit) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '') + '\u2026';
}

/**
 * The wave-optics assignments, which `npm run build-tasks` writes to `dist/tasks/` as a
 * self-contained page each.
 *
 * Read from the scene files rather than from a list kept here, so an assignment added to
 * `data/taskScenes` reaches the gallery without this script being edited. Only the wave-optics ones
 * are listed: the ray-optics scenes in that directory are the worked examples of the task format,
 * not finished assignments.
 *
 * The titles and descriptions come from each scene's `task`, so they are the same words the student
 * reads in the assignment itself, and are not translated — the assignments are authored in English.
 * Only the first sentence of the description is taken, shortened at a word boundary if it is still
 * long: the rest tells the student what to do, which is worth reading once the assignment is open
 * and is a wall of text on a thumbnail. The caption has room for three lines, and a sentence cut off
 * mid-word by the overflow reads worse than one that ends.
 *
 * @returns {Array<{id: string, name: string, description: string}>}
 */
function waveTaskList() {
  const dir = path.join(__dirname, '../data/taskScenes');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json') && name !== 'index.json' && !name.startsWith('.'))
    .map((name) => ({
      id: name.slice(0, -'.json'.length),
      scene: JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')),
    }))
    .filter(({ scene }) => (scene.objs ?? []).some((obj) => String(obj?.type ?? '').startsWith('Wave')))
    .map(({ id, scene }) => ({
      id,
      name: scene.task?.title ?? id,
      description: shorten((scene.task?.description ?? '').split(/(?<=\.)\s+/)[0], 110),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const waveTasks = waveTaskList();

const galleryLangs = [];
const modulesLangs = [];

const rootAbsUrl = "https://ssenhorst.github.io/wave-optics";
const urlMaps = {};
const langNames = {};
const i18nextResources = {};

const enMainData = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/en/main.json'), 'utf8'));
const enSimulatorData = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/en/simulator.json'), 'utf8'));
const enGalleryData = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/en/gallery.json'), 'utf8'));
const enModulesData = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/en/modules.json'), 'utf8'));

// Load the available languages for each webpage and create the URL maps
for (const lang of langs) {
  // See if the number of strings is large enough, otherwise skip this language.
  const mainPath = path.join(__dirname, '../locales', lang, 'main.json');
  const simulatorPath = path.join(__dirname, '../locales', lang, 'simulator.json');
  const galleryPath = path.join(__dirname, '../locales', lang, 'gallery.json');
  const modulesPath = path.join(__dirname, '../locales', lang, 'modules.json');
  const mainData = fs.existsSync(mainPath) ? JSON.parse(fs.readFileSync(mainPath, 'utf8')) : {};
  const simulatorData = fs.existsSync(simulatorPath) ? JSON.parse(fs.readFileSync(simulatorPath, 'utf8')) : {};
  //console.log(`The main part of ${lang} has ${countStrings(mainData.homePage) + countStrings(mainData.tools) + countStrings(mainData.view)} strings.`);
  if (!(
    mainData.meta && mainData.meta.languageName &&
    mainData.project && mainData.project.name &&
    (countStrings(mainData.homePage) + countStrings(mainData.tools) + countStrings(mainData.view)) > 50
  )) {
    continue;
  }

  const galleryData = fs.existsSync(galleryPath) ? JSON.parse(fs.readFileSync(galleryPath, 'utf8')) : {};
  const modulesData = fs.existsSync(modulesPath) ? JSON.parse(fs.readFileSync(modulesPath, 'utf8')) : {};

  // Add to the i18next resources
  i18nextResources[lang] = {
    main: mainData,
    simulator: simulatorData,
    gallery: galleryData,
    modules: modulesData,
  };
  
  // Add the language name
  langNames[lang] = mainData.meta.languageName || lang;

  urlMaps[lang] = {
    "/simulator": "/simulator/" + (lang === 'en' ? '' : '?' + lang),
    // The wave-optics app has no translations of its own yet, so there is only
    // one of it; the link is the same from every language's pages.
    "/wave": "/wave/",
    "/github": "https://github.com/ssenhorst/wave-optics",
    "/github/issues": "https://github.com/ssenhorst/wave-optics/issues",
    "/github/discussions": "https://github.com/ssenhorst/wave-optics/discussions",
    "/integrations": "https://github.com/ssenhorst/wave-optics/tree/dist-integrations",
    "/contributing": "https://github.com/ssenhorst/wave-optics/blob/master/CONTRIBUTING.md",
    "/contributing/gallery": "https://github.com/ssenhorst/wave-optics/blob/master/CONTRIBUTING.md#contributing-items-to-the-gallery",
    "/contributing/modules": "https://github.com/ssenhorst/wave-optics/blob/master/CONTRIBUTING.md#contributing-modules",
    "/license": "https://github.com/ssenhorst/wave-optics/blob/master/LICENSE",
    "/mathjs/syntax": "https://mathjs.org/docs/expressions/syntax.html",
    "/ai-tools/chatgpt": "https://chatgpt.com/g/g-6777588b53708191b66722e353e95125-ray-optics-coder",
    "/ai-tools/instructions": "https://github.com/ssenhorst/wave-optics/blob/master/ai-tools"
  };

  homeLangs.push(lang);
  urlMaps[lang]['/home'] = routesData[lang] + '/';

  if (mainData.aboutPage && mainData.pages && mainData.pages.about && mainData.aboutPage.description) {
    aboutLangs.push(lang);
    urlMaps[lang]['/about'] = routesData[lang] + '/about';
  } else {
    urlMaps[lang]['/about'] = '/about';
  }

  if (galleryData.galleryPage && mainData.pages && mainData.pages.gallery && galleryData.galleryPage.title && galleryData.galleryPage.description) {
    galleryLangs.push(lang);
    urlMaps[lang]['/gallery'] = routesData[lang] + '/gallery/';
  } else {
    urlMaps[lang]['/gallery'] = '/gallery/';
  }

  if (modulesData.modulesPage) {
    modulesLangs.push(lang);
    urlMaps[lang]['/modules/modules'] = routesData[lang] + '/modules/modules.html';
  } else {
    urlMaps[lang]['/modules/modules'] = '/modules/modules.html';
  }

}

// Initialize the i18next resources
i18next.init({
  lng: 'en',
  fallbackLng: 'en',
  load: 'currentOnly',
  ns: ['main', 'simulator', 'gallery', 'modules'],
  resources: i18nextResources,
  interpolation: {
    escapeValue: false
  }
});

// Configure the marked renderer
marked.setOptions({
  breaks: true,
});

// Create the pages
for (const lang of homeLangs) {
  // Change the language of i18next
  i18next.changeLanguage(lang);

  // Format the list of items in the current language
  function formatList(items) {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    return i18next.t('main:meta.list', {
      first: items[0],
      others: formatList(items.slice(1))
    });
  }

  // Create the directory for the language in the /dist directory
  const langDir = path.join(__dirname, '../dist', routesData[lang]);
  fs.mkdirSync(langDir, { recursive: true });

  // Determine the root URL for the language, relative to the current page being built
  let rootUrl = lang == 'en' ? '.' : '..';

  // Register the Handlebars helper
  Handlebars.registerHelper('t', function(key, options) {
    let markdownText = i18next.t(key, options.hash);

    // Map the URLs in the markdown text
    markdownText = markdownText.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, (match, p1, p2) => {
      if (urlMaps[lang][p2]) {
        if (urlMaps[lang][p2].startsWith('/')) {
          return `[${p1}](${rootUrl}${urlMaps[lang][p2]})`;
        } else {
          return `[${p1}](${urlMaps[lang][p2]})`;
        }
      } else {
        return match;
      }
    });
    
    // Wrap the inline LaTeX \(...\) in a code block  
    markdownText = markdownText.replace(/\\\((.*?)\\\)/g, (match, p1) => '`\\(' + p1 + '\\)`');

    // Wrap the LaTeX equations in a code block
    markdownText = markdownText.replace(/\\begin{equation}(.*?)\\end{equation}/g, (match, p1) => '```\\begin{equation}' + p1 + '\\end{equation}```');

    // Convert the markdown text to HTML
    let html = marked(markdownText).trim();

    // Replace the inline LaTeX back to \(...\)
    html = html.replace(/<code>\\\((.*?)\\\)<\/code>/g, (match, p1) => '\\(' + p1 + '\\)');

    // Replace the LaTeX equations back to \\begin{equation}...\end{equation}
    html = html.replace(/<code>\\begin{equation}(.*?)\\end{equation}<\/code>/g, (match, p1) => '\\begin{equation}' + p1 + '\\end{equation}');

    // Remove the outer <p> tag
    if (html.startsWith('<p>') && html.endsWith('</p>')) {
      html = html.substring(3, html.length - 4);
    }

    // If options contains "blank", replace the link with a target="_blank" link
    if (options.hash.blank) {
      html = html.replace(/<a href="/g, '<a target="_blank" href="');
    }

    // If the link is to ray-optics@phydemo.app, prevent it from wrapping.
    html = html.replace(/href="mailto:ray-optics@phydemo.app"/g, 'href="mailto:ray-optics@phydemo.app" style="white-space: nowrap;"');

    return new Handlebars.SafeString(html);
  });

  // Register the partials
  Handlebars.registerPartial('head', fs.readFileSync(path.join(__dirname, '../src/pages/partials/head.hbs'), 'utf8'));
  Handlebars.registerPartial('navbar', fs.readFileSync(path.join(__dirname, '../src/pages/partials/navbar.hbs'), 'utf8'));
  Handlebars.registerPartial('footer', fs.readFileSync(path.join(__dirname, '../src/pages/partials/footer.hbs'), 'utf8'));

  // Load the home template
  const homeTemplate = Handlebars.compile(fs.readFileSync(path.join(__dirname, '../src/pages/home.hbs'), 'utf8'));

  const homeData = {
    title: i18next.t('main:project.name'),
    ogImage: rootAbsUrl + '/img/image.png',
    absUrl: rootAbsUrl + urlMaps[lang]['/home'],
    lang: lang,
    langName: langNames[lang],
    supportedLangs: homeLangs.map((lang) => {
      return {
        lang: lang,
        name: langNames[lang],
        url: rootUrl + urlMaps[lang]['/home'],
        absUrl: rootAbsUrl + urlMaps[lang]['/home'],
      };
    }),
    imgUrl: rootUrl + '/img',
    thirdpartyUrl: rootUrl + '/thirdparty',
    homeUrl: rootUrl + urlMaps[lang]['/home'],
    aboutUrl: rootUrl + urlMaps[lang]['/about'],
    galleryUrl: rootUrl + urlMaps[lang]['/gallery'],
    simulatorUrl: rootUrl + urlMaps[lang]['/simulator'],
    waveUrl: rootUrl + urlMaps[lang]['/wave'],
    isHome: true,
    isGallery: false,
    isAbout: false,
    carousel: waveCarousel(rootUrl, rootUrl + urlMaps[lang]['/wave']),
    categories: waveCategories(rootUrl),
    views: waveViews(rootUrl),
    exampleStrip: waveExampleStrip(rootUrl, rootUrl + urlMaps[lang]['/wave']),
  }

  // Create the webpage
  fs.writeFileSync(path.join(langDir, 'index.html'), homeTemplate(homeData));


  // Create the about webpage
  if (aboutLangs.includes(lang)) {

    function formatContributions(contributions) {
      const contribItems = [];
      if (contributions.code) contribItems.push(i18next.t('main:aboutPage.contributionCategories.code'));
      if (contributions.uiDesign) contribItems.push(i18next.t('main:aboutPage.contributionCategories.uiDesign'));
      if (contributions.gallery) contribItems.push(i18next.t('main:aboutPage.contributionCategories.gallery'));
      if (contributions.modules) contribItems.push(i18next.t('main:aboutPage.contributionCategories.module'));
      if (contributions.translations) {
        contribItems.push(i18next.t('main:aboutPage.contributionCategories.translations', {
          count: contributions.translations.length,
          languages: contributions.translations.map(lang => `<span style="font-family: monospace;">${lang}</span>`).join(' & ')
        }));
      }
      return formatList(contribItems);
    }
    const aboutTemplate = Handlebars.compile(fs.readFileSync(path.join(__dirname, '../src/pages/about.hbs'), 'utf8'));
    const aboutData = {
      title: i18next.t('main:pages.about') + ' - ' + i18next.t('main:project.name'),
      ogImage: rootAbsUrl + '/img/image.png',
      absUrl: rootAbsUrl + urlMaps[lang]['/about'],
      lang: lang,
      langName: langNames[lang],
      supportedLangs: aboutLangs.map((lang) => {
        return {
          lang: lang,
          name: langNames[lang],
          url: rootUrl + urlMaps[lang]['/about'],
          absUrl: rootAbsUrl + urlMaps[lang]['/about'],
        };
      }),
      imgUrl: rootUrl + '/img',
      thirdpartyUrl: rootUrl + '/thirdparty',
      homeUrl: rootUrl + urlMaps[lang]['/home'],
      aboutUrl: rootUrl + urlMaps[lang]['/about'],
      galleryUrl: rootUrl + urlMaps[lang]['/gallery'],
      simulatorUrl: rootUrl + urlMaps[lang]['/simulator'],
      waveUrl: rootUrl + urlMaps[lang]['/wave'],
      isHome: false,
      isGallery: false,
      isAbout: true,
      version: (() => {
        const fullPackageVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'))).version;
        if (isRelease) {
          // For release builds, use the full major.minor.patch version
          return fullPackageVersion;
        } else {
          // Extract major.minor, ignoring patch version
          const packageVersion = fullPackageVersion.split('.').slice(0, 2).join('.');
          const lastCommit = logEntries.split('\n').slice(-1)[0].split('|');
          const commitDate = new Date(lastCommit[3]).toISOString().slice(0,10).replace(/-/g,'');
          const commitHash = lastCommit[0].slice(0,7);
          return `${packageVersion}+${commitDate}.${commitHash}`;
        }
      })(),
      mainAuthors: sortedMainAuthors.map(c => {
        const name = (c.name === 'Yi-Ting Tu' && lang.startsWith('zh') ? '凃懿庭 Yi-Ting Tu' : c.name);
        const url = (c.name === 'Yi-Ting Tu') ? 'https://yitingtu.com' : '';
        return new Handlebars.SafeString(i18next.t('main:meta.parentheses', {
          main: url ? `<a href="${url}">${name}</a>` : name,
          sub: formatContributions(c.contributions)
        }));
      }),
      contributors: sortedContributors.map(c => {
        return new Handlebars.SafeString(i18next.t('main:meta.parentheses', {
          main: c.name,
          sub: formatContributions(c.contributions)
        }))
      }),
    }
    fs.writeFileSync(path.join(langDir, 'about.html'), aboutTemplate(aboutData));
  }

  // Create the gallery webpage
  if (galleryLangs.includes(lang)) {
    // Create the gallery/ directory
    const galleryDir = path.join(langDir, 'gallery');
    fs.mkdirSync(galleryDir, { recursive: true });
    rootUrl = lang == 'en' ? '..' : '../..';

    const galleryTemplate = Handlebars.compile(fs.readFileSync(path.join(__dirname, '../src/pages/gallery.hbs'), 'utf8'));
    const galleryData = {
      title: i18next.t('main:pages.gallery') + ' - ' + i18next.t('main:project.name'),
      ogImage: rootAbsUrl + '/img/image.png',
      absUrl: rootAbsUrl + urlMaps[lang]['/gallery'],
      lang: lang,
      langName: langNames[lang],
      supportedLangs: galleryLangs.map((lang) => {
        return {
          lang: lang,
          name: langNames[lang],
          url: rootUrl + urlMaps[lang]['/gallery'],
          absUrl: rootAbsUrl + urlMaps[lang]['/gallery'],
        };
      }),
      imgUrl: rootUrl + '/img',
      thirdpartyUrl: rootUrl + '/thirdparty',
      homeUrl: rootUrl + urlMaps[lang]['/home'],
      aboutUrl: rootUrl + urlMaps[lang]['/about'],
      galleryUrl: rootUrl + urlMaps[lang]['/gallery'],
      simulatorUrl: rootUrl + urlMaps[lang]['/simulator'],
      waveUrl: rootUrl + urlMaps[lang]['/wave'],
      // The wave-optics examples are built in the app from the viewport they
      // are loaded into, so there is no scene file and no rendered thumbnail
      // for them; they are listed as links that open the app on each one.
      waveExamples: EXAMPLE_SCENES.map((example) => ({
        name: example.name,
        description: example.description,
        image: `${rootUrl}/img/wave/thumbnail-${example.id}.jpg`,
        url: rootUrl + urlMaps[lang]['/wave'] + '#' + example.id,
      })),
      // The assignments, which are pages rather than scenes: each is one self-contained file that
      // carries the applet, the scene and the goals, so it opens without the app around it.
      waveTasks: waveTasks.map((task) => ({
        name: task.name,
        description: task.description,
        image: `${rootUrl}/img/tasks/thumbnail-${task.id}.jpg`,
        url: `${rootUrl}/tasks/${task.id}.html`,
      })),
      isHome: false,
      isGallery: true,
      isAbout: false,
    }
    fs.writeFileSync(path.join(galleryDir, 'index.html'), galleryTemplate(galleryData));
  }


  // Create the modules webpage
  if (modulesLangs.includes(lang)) {
    // create the modules/ directory
    const modulesDir = path.join(langDir, 'modules');
    fs.mkdirSync(modulesDir, { recursive: true });
    rootUrl = lang == 'en' ? '..' : '../..';

    // Load the modules template
    const modulesTemplate = Handlebars.compile(fs.readFileSync(path.join(__dirname, '../src/pages/modules.hbs'), 'utf8'));
    const modulePageData = {
      lang: lang,
      langName: langNames[lang],
      imgUrl: rootUrl + '/img',
      thirdpartyUrl: rootUrl + '/thirdparty',
      content: moduleList[0].content.map(item => {
        return {
          id: item.id,
          thumbnailUrl: rootUrl + '/modules/' + item.id + '-thumbnail',
          titleKey: 'modules:moduleData.' + item.id + '.title',
          contributors: item.contributors.join(', '),
          descriptionKey: 'modules:moduleData.' + item.id + '.description',
          hasControlPoints: moduleControlPointSequenceKeys[item.id].length > 0,
          hasParameters: Object.keys(moduleParametersKeys[item.id]).length > 0,
          controlPointSequenceKeys: moduleControlPointSequenceKeys[item.id],
          parametersKeys: moduleParametersKeys[item.id],
          beta: !!item.beta,
        };
      }),
    }
    fs.writeFileSync(path.join(modulesDir, 'modules.html'), modulesTemplate(modulePageData));
  }
}
