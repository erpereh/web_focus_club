// scripts/reorganize-cms-media.cjs
// Reorganiza assets usados por CMS/Home en carpetas protegidas:
// - mueve fisicamente en Storage (copy + delete)
// - actualiza media_files (storagePath, url, folderId)
// - actualiza referencias en site_content/main, site_config/general y gallery_items
//
// Ejecucion:
// node scripts/reorganize-cms-media.cjs
//
// Variables opcionales:
// FIREBASE_SERVICE_ACCOUNT_PATH=./service-account.json
// FIREBASE_STORAGE_BUCKET=focus-club-f73b8.firebasestorage.app

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(ROOT, 'focus-club-f73b8-firebase-adminsdk-fbsvc-3355d90550.json');
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  ? path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
  : DEFAULT_SERVICE_ACCOUNT_PATH;
const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'focus-club-f73b8.firebasestorage.app';

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  throw new Error(`No se encontro service account en: ${SERVICE_ACCOUNT_PATH}`);
}

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: BUCKET,
});

const db = admin.firestore();
const bucket = admin.storage().bucket();
const argv = new Set(process.argv.slice(2));
const repairOnly = argv.has('--repair-only');

const TARGETS = {
  branding: {
    name: 'Branding',
    configDocId: 'branding_folder',
    basePath: 'public/imagenes/branding',
  },
  sandra: {
    name: 'Sandra',
    configDocId: 'sandra_folder',
    basePath: 'public/imagenes/sandra',
  },
  centro: {
    name: 'El Centro',
    configDocId: 'centro_folder',
    basePath: 'public/imagenes/el_centro',
  },
  gallery: {
    name: 'Galeria Publica',
    configDocId: 'gallery_folder',
    basePath: 'public/imagenes/galeria',
  },
  home: {
    name: 'Home',
    configDocId: 'home_folder',
    basePath: 'public/imagenes/home',
  },
};

function isStorageUrl(url) {
  return typeof url === 'string' && url.includes('firebasestorage.googleapis.com');
}

function extFromPath(filePath, fallback = 'jpg') {
  const raw = path.extname(filePath || '').replace('.', '').toLowerCase();
  if (!raw) return fallback;
  return raw.length > 5 ? fallback : raw;
}

function buildDownloadUrl(storagePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

function getStoragePathFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/o\/([^?]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getTokenFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('token');
  } catch {
    return null;
  }
}

function setDeepValue(obj, pathStr, value) {
  const parts = pathStr.split('.');
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const nextPart = parts[i + 1];
    const isNextIndex = /^\d+$/.test(nextPart);
    if (cursor[part] === undefined || cursor[part] === null) {
      cursor[part] = isNextIndex ? [] : {};
    }
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

async function ensureProtectedFolder(target) {
  const configRef = db.collection('system_config').doc(target.configDocId);
  const configSnap = await configRef.get();
  const existingFolderId = configSnap.exists ? configSnap.data()?.folderId : null;

  if (existingFolderId) {
    const folderSnap = await db.collection('media_folders').doc(existingFolderId).get();
    if (folderSnap.exists) return existingFolderId;
  }

  const existingByName = await db
    .collection('media_folders')
    .where('name', '==', target.name)
    .limit(1)
    .get();

  let folderId;
  if (!existingByName.empty) {
    folderId = existingByName.docs[0].id;
  } else {
    const createdRef = await db.collection('media_folders').add({
      name: target.name,
      parentId: null,
      createdAt: new Date().toISOString(),
    });
    folderId = createdRef.id;
  }

  await configRef.set(
    {
      folderId,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  return folderId;
}

async function findMediaFileByUrlOrPath(url) {
  if (!url || typeof url !== 'string') return null;

  const byUrl = await db.collection('media_files').where('url', '==', url).limit(1).get();
  if (!byUrl.empty) return byUrl.docs[0];

  // Fallback for stale URLs: try by storagePath parsed from URL.
  const match = url.match(/\/o\/([^?]+)/);
  if (!match) return null;
  const storagePath = decodeURIComponent(match[1]);
  const byPath = await db.collection('media_files').where('storagePath', '==', storagePath).limit(1).get();
  if (!byPath.empty) return byPath.docs[0];

  return null;
}

async function ensureDownloadUrl(storagePath, currentUrl, metadata) {
  const file = bucket.file(storagePath);
  const fileMeta = metadata ?? (await file.getMetadata())[0];
  const customMetadata = fileMeta?.metadata ?? {};
  let token = customMetadata.firebaseStorageDownloadTokens ?? getTokenFromUrl(currentUrl) ?? null;

  if (!token) {
    token = crypto.randomUUID();
    await file.setMetadata({
      metadata: {
        ...customMetadata,
        firebaseStorageDownloadTokens: token,
      },
    });
  }

  return buildDownloadUrl(storagePath, token);
}

async function ensureMediaRecordHealthy(mediaDoc, expectedFolderId, expectedBasePath) {
  const media = mediaDoc.data();
  const storagePath = media.storagePath;
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    return {
      ok: false,
      reason: 'missing-object',
    };
  }

  const [metadata] = await file.getMetadata();
  const fixedUrl = await ensureDownloadUrl(storagePath, media.url, metadata);
  const changes = {};
  const alreadyInTargetPath = typeof storagePath === 'string' && storagePath.startsWith(`${expectedBasePath}/`);

  if (media.url !== fixedUrl) changes.url = fixedUrl;
  if ((media.folderId ?? null) !== expectedFolderId && alreadyInTargetPath) changes.folderId = expectedFolderId;

  if (Object.keys(changes).length > 0) {
    changes.updatedAt = new Date().toISOString();
    await mediaDoc.ref.update(changes);
  }

  return {
    ok: true,
    moved: false,
    repaired: Object.keys(changes).length > 0,
    url: fixedUrl,
    storagePath,
    folderId: alreadyInTargetPath ? expectedFolderId : (media.folderId ?? null),
  };
}

async function moveMediaToTarget(mediaDoc, targetFolderId, targetBasePath) {
  const media = mediaDoc.data();
  const oldPath = media.storagePath;
  const oldFolderId = media.folderId ?? null;
  const extension = extFromPath(oldPath, media.type === 'video' ? 'mp4' : 'jpg');

  const alreadyInTargetPath = typeof oldPath === 'string' && oldPath.startsWith(`${targetBasePath}/`);
  if (oldFolderId === targetFolderId && alreadyInTargetPath) {
    return ensureMediaRecordHealthy(mediaDoc, targetFolderId, targetBasePath);
  }

  const newPath = `${targetBasePath}/${crypto.randomUUID()}.${extension}`;
  const oldFile = bucket.file(oldPath);
  const newFile = bucket.file(newPath);

  const [oldExists] = await oldFile.exists();
  if (!oldExists) {
    return {
      ok: false,
      reason: 'missing-object',
    };
  }

  let oldMeta = {};
  let oldFileMetadata = null;
  const [meta] = await oldFile.getMetadata();
  oldFileMetadata = meta;
  oldMeta = meta?.metadata ?? {};

  const token = crypto.randomUUID();
  await oldFile.copy(newFile, {
    metadata: {
      contentType: oldFileMetadata?.contentType,
      cacheControl: oldFileMetadata?.cacheControl,
      metadata: {
        ...oldMeta,
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  await oldFile.delete({ ignoreNotFound: true });

  const newUrl = buildDownloadUrl(newPath, token);

  await mediaDoc.ref.update({
    storagePath: newPath,
    url: newUrl,
    folderId: targetFolderId,
    updatedAt: new Date().toISOString(),
  });

  return {
    ok: true,
    moved: true,
    repaired: false,
    url: newUrl,
    storagePath: newPath,
    folderId: targetFolderId,
  };
}

async function main() {
  console.log(`Iniciando ${repairOnly ? 'reparacion' : 'reorganizacion'} de medios CMS/Home...\n`);

  const folderIds = {};
  for (const [key, target] of Object.entries(TARGETS)) {
    folderIds[key] = await ensureProtectedFolder(target);
    console.log(`- Carpeta protegida ${target.name}: ${folderIds[key]}`);
  }

  const siteContentRef = db.collection('site_content').doc('main');
  const siteContentSnap = await siteContentRef.get();
  const siteContent = siteContentSnap.exists ? siteContentSnap.data() : {};

  const generalConfigRef = db.collection('site_config').doc('general');
  const generalConfigSnap = await generalConfigRef.get();
  const generalConfig = generalConfigSnap.exists ? generalConfigSnap.data() : {};

  const references = [];

  // Branding / logo.
  if (isStorageUrl(generalConfig?.logoUrl)) {
    references.push({
      source: 'site_config/general.logoUrl',
      kind: 'site_config_general',
      path: 'logoUrl',
      url: generalConfig.logoUrl,
      target: 'branding',
    });
  }

  // Home / Hero.
  if (isStorageUrl(siteContent?.heroBackgroundUrl)) {
    references.push({
      source: 'site_content/main.heroBackgroundUrl',
      kind: 'site_content_main',
      path: 'heroBackgroundUrl',
      url: siteContent.heroBackgroundUrl,
      target: 'home',
    });
  }
  if (isStorageUrl(siteContent?.heroImage)) {
    references.push({
      source: 'site_content/main.heroImage',
      kind: 'site_content_main',
      path: 'heroImage',
      url: siteContent.heroImage,
      target: 'home',
    });
  }

  // Sandra.
  if (isStorageUrl(siteContent?.aboutImage)) {
    references.push({
      source: 'site_content/main.aboutImage',
      kind: 'site_content_main',
      path: 'aboutImage',
      url: siteContent.aboutImage,
      target: 'sandra',
    });
  }
  if (isStorageUrl(siteContent?.sandra?.image)) {
    references.push({
      source: 'site_content/main.sandra.image',
      kind: 'site_content_main',
      path: 'sandra.image',
      url: siteContent.sandra.image,
      target: 'sandra',
    });
  }

  // Centro.
  const zonas = Array.isArray(siteContent?.centro?.zonas) ? siteContent.centro.zonas : [];
  zonas.forEach((zona, i) => {
    if (isStorageUrl(zona?.image)) {
      references.push({
        source: `site_content/main.centro.zonas[${i}].image`,
        kind: 'site_content_main',
        path: `centro.zonas.${i}.image`,
        url: zona.image,
        target: 'centro',
      });
    }
  });

  // Galeria trainings.
  const trainings = Array.isArray(siteContent?.galeria?.trainings) ? siteContent.galeria.trainings : [];
  trainings.forEach((item, i) => {
    if (isStorageUrl(item?.mediaUrl)) {
      references.push({
        source: `site_content/main.galeria.trainings[${i}].mediaUrl`,
        kind: 'site_content_main',
        path: `galeria.trainings.${i}.mediaUrl`,
        url: item.mediaUrl,
        target: 'gallery',
      });
    }
  });

  // Gallery items.
  const galleryItemsSnap = await db.collection('gallery_items').get();
  galleryItemsSnap.docs.forEach((docSnap) => {
    const data = docSnap.data();
    if (isStorageUrl(data?.url)) {
      references.push({
        source: `gallery_items/${docSnap.id}.url`,
        kind: 'gallery_item',
        docId: docSnap.id,
        path: 'url',
        url: data.url,
        target: 'gallery',
      });
    }
  });

  console.log(`\nReferencias detectadas: ${references.length}`);

  const movedByOriginalUrl = new Map();
  const siteContentChanges = {};
  const generalConfigChanges = {};
  let movedCount = 0;
  let repairedCount = 0;
  let alreadyOkCount = 0;
  let skippedCount = 0;

  for (const ref of references) {
    const target = TARGETS[ref.target];
    const targetFolderId = folderIds[ref.target];

    let moveResult = movedByOriginalUrl.get(ref.url);
    if (!moveResult) {
      const mediaDoc = await findMediaFileByUrlOrPath(ref.url);
      if (!mediaDoc) {
        skippedCount += 1;
        console.log(`  [SKIP] Sin media_files para ${ref.source}`);
        continue;
      }

      moveResult = repairOnly
        ? await ensureMediaRecordHealthy(mediaDoc, targetFolderId, target.basePath)
        : await moveMediaToTarget(mediaDoc, targetFolderId, target.basePath);
      movedByOriginalUrl.set(ref.url, moveResult);

      if (!moveResult.ok) {
        skippedCount += 1;
        console.log(`  [SKIP] ${ref.source} -> ${moveResult.reason}`);
        continue;
      }

      if (moveResult.moved) {
        movedCount += 1;
        console.log(`  [MOVE] ${ref.source} -> ${target.basePath}`);
      } else if (moveResult.repaired) {
        repairedCount += 1;
        console.log(`  [REPAIR] ${ref.source} URL/metadata reconciliada`);
      } else {
        alreadyOkCount += 1;
        console.log(`  [OK] ${ref.source} ya estaba en ${target.basePath}`);
      }
    }

    if (ref.kind === 'site_content_main') {
      setDeepValue(siteContent, ref.path, moveResult.url);
      siteContentChanges[ref.path] = moveResult.url;
      continue;
    }

    if (ref.kind === 'site_config_general') {
      setDeepValue(generalConfig, ref.path, moveResult.url);
      generalConfigChanges[ref.path] = moveResult.url;
      continue;
    }

    if (ref.kind === 'gallery_item') {
      await db.collection('gallery_items').doc(ref.docId).set({ url: moveResult.url }, { merge: true });
      continue;
    }
  }

  if (Object.keys(siteContentChanges).length > 0) {
    await siteContentRef.set(siteContent, { merge: true });
  }

  if (Object.keys(generalConfigChanges).length > 0) {
    await generalConfigRef.set(generalConfig, { merge: true });
  }

  console.log('\nResumen:');
  console.log(`- Movidos: ${movedCount}`);
  console.log(`- Reparados: ${repairedCount}`);
  console.log(`- Ya correctos: ${alreadyOkCount}`);
  console.log(`- Omitidos (sin media_files): ${skippedCount}`);
  console.log('\nListo.');
}

main().catch((err) => {
  console.error('\nError en reorganizacion:', err);
  process.exit(1);
});
