'use strict';

// Node's sqlite exposes extended result codes; their low byte identifies BUSY
// and LOCKED without treating disk, corruption or other failures as contention.
const isSqliteBusy = error => error?.code === 'ERR_SQLITE_ERROR' && [5, 6].includes((error.errcode || 0) & 0xff);
module.exports = {isSqliteBusy};
