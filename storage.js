const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('exhibit-cards', 2);
  request.onupgradeneeded = event => {
    if (event.oldVersion === 0) request.result.createObjectStore('records', { keyPath: 'id' });
    request.result.createObjectStore('photos');
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function transaction(stores, mode, operation) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    try {
      result = operation(tx);
    } catch (error) {
      tx.abort();
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result());
    tx.onabort = () => reject(tx.error ?? new Error('Local transaction failed'));
  });
}

export async function putRecord(record) {
  const { photo, ...fields } = record;
  const image = photo ? { bytes: await photo.arrayBuffer(), type: photo.type } : null;
  return transaction(['records', 'photos'], 'readwrite', tx => {
    const request = tx.objectStore('records').put(fields);
    const images = tx.objectStore('photos');
    if (image) images.put(image, fields.id);
    else images.delete(fields.id);
    return () => request.result;
  });
}

function unpack(row, image, includePhoto) {
  const { photoBytes, photoType, photo, ...record } = row;
  if (includePhoto) {
    if (image) record.photo = new Blob([image.bytes], { type: image.type });
    else if (photoBytes) record.photo = new Blob([photoBytes], { type: photoType });
    else if (photo) record.photo = photo;
  }
  return record;
}

export async function getRecord(id) {
  return transaction(['records', 'photos'], 'readonly', tx => {
    const row = tx.objectStore('records').get(id);
    const image = tx.objectStore('photos').get(id);
    return () => row.result && unpack(row.result, image.result, true);
  });
}

export async function listRecords(includePhotos = false) {
  return transaction(includePhotos ? ['records', 'photos'] : 'records', 'readonly', tx => {
    const rows = tx.objectStore('records').getAll();
    const images = new Map();
    if (includePhotos) {
      const cursor = tx.objectStore('photos').openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (item) {
          images.set(item.key, item.value);
          item.continue();
        }
      };
    }
    return () => rows.result.sort((a, b) => b.updated.localeCompare(a.updated))
      .map(row => unpack(row, images.get(row.id), includePhotos));
  });
}
