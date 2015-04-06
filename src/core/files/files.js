angular.module('classeur.core.files', [])
	.factory('clFileSvc', function($window, $timeout, clUid, clLocalStorageObject, clSocketSvc) {
		var maxLocalFiles = 3;
		var fileDaoProto = clLocalStorageObject('f', true);
		var contentDaoProto = clLocalStorageObject('c', true);

		function FileDao(id) {
			this.id = id;
			this.$setId(id);
			this.contentDao = Object.create(contentDaoProto);
			this.contentDao.$setId(id);
			this.read();
			this.readContent();
		}

		FileDao.prototype = fileDaoProto;

		FileDao.prototype.read = function() {
			this.$readAttr('name', '');
			this.$readAttr('folderId', '');
			this.$readAttr('sharing', '');
			this.$readAttr('userId', '');
			this.$readUpdate();
		};

		FileDao.prototype.write = function(updated) {
			this.$writeAttr('name', undefined, updated);
			this.$writeAttr('folderId', undefined, updated);
			this.$writeAttr('sharing', undefined, updated);
			this.$writeAttr('userId', undefined, updated);
		};

		FileDao.prototype.readContent = function() {
			this.contentDao.$readAttr('isLocal', '');
			this.contentDao.$readAttr('lastChange', '0', parseInt);
			if (this.state === 'loaded') {
				this.contentDao.$readAttr('txt', '');
				this.contentDao.$readAttr('properties', '{}', JSON.parse);
				this.contentDao.$readAttr('discussions', '{}', JSON.parse);
				this.contentDao.$readAttr('state', '{}', JSON.parse);
			}
			this.contentDao.$readUpdate();
		};

		FileDao.prototype.freeContent = function() {
			this.contentDao.$freeAttr('txt');
			this.contentDao.$freeAttr('properties');
			this.contentDao.$freeAttr('discussions');
			this.contentDao.$freeAttr('state');
		};

		FileDao.prototype.writeContent = function(updateLastChange) {
			this.contentDao.$writeAttr('isLocal');
			if (this.state === 'loaded') {
				updateLastChange |= this.contentDao.$writeAttr('txt');
				updateLastChange |= this.contentDao.$writeAttr('properties', JSON.stringify);
				updateLastChange |= this.contentDao.$writeAttr('discussions', JSON.stringify);
				this.contentDao.$writeAttr('state', JSON.stringify);
			}
			if (!this.contentDao.isLocal) {
				this.contentDao.lastChange = '';
				this.contentDao.$writeAttr('lastChange', undefined, 0);
			} else if (updateLastChange) {
				this.contentDao.lastChange = Date.now();
				this.contentDao.$writeAttr('lastChange');
			}
		};

		FileDao.prototype.load = function() {
			if (this.state) {
				return;
			}
			if (this.contentDao.isLocal) {
				this.state = 'loading';
				$timeout((function() {
					if (this.state === 'loading') {
						this.state = 'loaded';
						this.readContent();
					}
				}).bind(this));
			} else if (clSocketSvc.isReady || (this.userId && $window.navigator.onLine !== false)) {
				this.state = 'loading';
			}
		};

		FileDao.prototype.unload = function() {
			this.freeContent();
			this.state = undefined;
		};

		FileDao.prototype.loadExecUnload = function(cb) {
			var state = this.state;
			if (state === 'loaded') {
				return cb();
			}
			this.state = 'loaded';
			this.readContent();
			cb();
			this.freeContent();
			this.state = state;
		};

		function ReadOnlyFile(name, content) {
			this.name = name;
			this.contentDao = {
				txt: content,
				state: {},
				properties: {},
				users: {},
				discussions: {}
			};
			this.isReadOnly = true;
			this.state = 'loaded';
			this.unload = function() {};
		}

		var clFileSvc = clLocalStorageObject('fileSvc');

		var fileAuthorizedKeys = {
			u: true,
			userId: true,
			name: true,
			sharing: true,
			folderId: true,
		};

		var contentAuthorizedKeys = {
			u: true,
			lastChange: true,
			isLocal: true,
			txt: true,
			properties: true,
			users: true,
			discussions: true,
			state: true,
		};

		var isInited;

		function init() {
			if (!clFileSvc.fileIds) {
				clFileSvc.$readAttr('fileIds', '[]', JSON.parse);
				clFileSvc.fileMap = {};
				clFileSvc.fileIds = clFileSvc.fileIds.filter(function(id) {
					if (!clFileSvc.fileMap.hasOwnProperty(id)) {
						var fileDao = new FileDao(id);
						if (!fileDao.userId || fileDao.contentDao.isLocal) {
							clFileSvc.fileMap[id] = fileDao;
							return true;
						}
					}
				});
				(clFileSvc.files || []).forEach(function(fileDao) {
					!clFileSvc.fileMap.hasOwnProperty(fileDao.id) && fileDao.unload();
				});
				if (!isInited) {
					var fileKeyPrefix = /^f\.(\w+)\.(\w+)/;
					var contentKeyPrefix = /^c\.(\w+)\.(\w+)/;
					for (var key in localStorage) {
						var fileDao, match = key.match(fileKeyPrefix);
						if (match) {
							fileDao = clFileSvc.fileMap[match[1]];
							if (!fileDao || !fileAuthorizedKeys.hasOwnProperty(match[2])) {
								localStorage.removeItem(key);
							}
							continue;
						}
						match = key.match(contentKeyPrefix);
						if (match) {
							fileDao = clFileSvc.fileMap[match[1]];
							if (!fileDao || !contentAuthorizedKeys.hasOwnProperty(match[2]) || !fileDao.contentDao.isLocal) {
								localStorage.removeItem(key);
							}
						}
					}
					isInited = true;
				}
			}
			clFileSvc.files = clFileSvc.fileIds.map(function(id) {
				return clFileSvc.fileMap[id] || new FileDao(id);
			});
			clFileSvc.fileMap = {};
			clFileSvc.localFiles = [];
			clFileSvc.files.forEach(function(fileDao) {
				clFileSvc.fileMap[fileDao.id] = fileDao;
				fileDao.contentDao.isLocal && clFileSvc.localFiles.push(fileDao);
			});

			clFileSvc.localFiles.sort(function(fileDao1, fileDao2) {
				return fileDao2.contentDao.lastChange - fileDao1.contentDao.lastChange;
			}).splice(maxLocalFiles).forEach(function(fileDao) {
				fileDao.unload();
				fileDao.contentDao.isLocal = '';
				fileDao.writeContent();
			});
		}

		function checkAll() {
			// Check file id list
			var checkFileSvcUpdate = clFileSvc.$checkUpdate();
			clFileSvc.$readUpdate();
			if (checkFileSvcUpdate && clFileSvc.$checkAttr('fileIds', '[]')) {
				clFileSvc.fileIds = undefined;
			} else {
				clFileSvc.$writeAttr('fileIds', JSON.stringify);
			}

			// Check every file
			var checkFileUpdate = fileDaoProto.$checkGlobalUpdate();
			fileDaoProto.$readGlobalUpdate();
			var checkContentUpdate = contentDaoProto.$checkGlobalUpdate();
			contentDaoProto.$readGlobalUpdate();
			clFileSvc.files.forEach(function(fileDao) {
				if (checkFileUpdate && fileDao.$checkUpdate()) {
					fileDao.read();
				} else {
					fileDao.write();
				}
				if (checkContentUpdate && fileDao.contentDao.$checkUpdate()) {
					fileDao.unload();
					fileDao.readContent();
				} else {
					fileDao.writeContent();
				}
			});

			if (checkFileSvcUpdate || checkFileUpdate || checkContentUpdate) {
				init();
				return true;
			}
		}

		function createFile(id) {
			id = id || clUid();
			var fileDao = new FileDao(id);
			fileDao.contentDao.isLocal = '1';
			fileDao.writeContent(true);
			clFileSvc.fileMap[id] = fileDao;
			clFileSvc.fileIds.push(id);
			init();
			return fileDao;
		}

		function createPublicFile(userId, id) {
			var fileDao = new FileDao(id);
			fileDao.userId = userId;
			// File is added to the list by sync module
			return fileDao;
		}

		function createReadOnlyFile(name, content) {
			return new ReadOnlyFile(name, content);
		}

		function removeFiles(fileDaoList) {
			if (!fileDaoList.length) {
				return;
			}
			var fileIds = {};
			fileDaoList.forEach(function(fileDao) {
				fileDao.unload();
				fileIds[fileDao.id] = 1;
			});
			clFileSvc.fileIds = clFileSvc.fileIds.filter(function(fileId) {
				return !fileIds.hasOwnProperty(fileId);
			});
			init();
		}

		function updateFiles(changes) {
			changes.forEach(function(change) {
				var fileDao = clFileSvc.fileMap[change.id];
				if (change.deleted && fileDao) {
					fileDao.unload();
					var index = clFileSvc.files.indexOf(fileDao);
					clFileSvc.fileIds.splice(index, 1);
				} else if (!change.deleted && !fileDao) {
					fileDao = new FileDao(change.id);
					clFileSvc.fileMap[change.id] = fileDao;
					clFileSvc.fileIds.push(change.id);
				}
				fileDao.name = change.name || '';
				fileDao.folderId = change.folderId || '';
				fileDao.sharing = change.sharing || '';
				fileDao.write(change.updated);
			});
			init();
		}

		clFileSvc.fileDaoProto = fileDaoProto;
		clFileSvc.init = init;
		clFileSvc.checkAll = checkAll;
		clFileSvc.createFile = createFile;
		clFileSvc.createPublicFile = createPublicFile;
		clFileSvc.createReadOnlyFile = createReadOnlyFile;
		clFileSvc.removeFiles = removeFiles;
		clFileSvc.updateFiles = updateFiles;
		clFileSvc.fileMap = {};

		init();
		return clFileSvc;
	});
