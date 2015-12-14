var async = require('async');
var moment = require('moment');
var url = require('url');
var request = require('request');
var uuid = require('node-uuid');

var Readable = require('stream').Readable;
var Writable = require('stream').Writable;
var Duplex = require('stream').Duplex;

function includes(array, searchElement) {
	'use strict';
	var O = array;
	var len = parseInt(O.length) || 0;
	if (len === 0) {
	  return false;
	}
	var n = parseInt(arguments[1]) || 0;
	var k;
	if (n >= 0) {
	  k = n;
	} else {
	  k = len + n;
	  if (k < 0) {k = 0;}
	}
	var currentElement;
	while (k < len) {
	  currentElement = O[k];
	  if (searchElement === currentElement ||
		 (searchElement !== searchElement && currentElement !== currentElement)) {
		return true;
	  }
	  k++;
	}
	return false;
};



function AzureBlob(api) {
    this.api = api;
}

(function () {

    this.generateMetadata = function (assetId, cb) {
        request({
            method: 'GET',
            uri: this.api.config.base_url + '/CreateFileInfos',
            qs: {assetid: "'" + assetId + "'"},
            headers: this.api.defaultHeaders(),
            strictSSL: true
        }, function (err, res) {
            cb();
        });
    };

    this.getUploadUrl = function (filename, cb) {
      async.waterfall([
        //create an asset
        function (cb) {
          this.api.rest.asset.create({Name: filename}, cb);
        }.bind(this),
        //create a policy
        function (asset, cb) {
          this.api.rest.accesspolicy.findOrCreate(300, 2, function (err, result) {
            cb(err, {asset: asset, policy: result});
          }.bind(this));
        }.bind(this),
        //create a location
        function (results, cb) {
          this.api.rest.locator.create({
            StartTime: moment.utc().subtract(10, 'minutes').format('M/D/YYYY hh:mm:ss A'),
            AccessPolicyId: results.policy.Id,
            AssetId: results.asset.Id,
            Type: 1,
          }, function (err, locator) {
            results.locator = locator;
            cb(err, results);
          }.bind(this));
        }.bind(this),
      ], function (err, result){
        if(err) {
          cb(err);
        }
        else{
          var path = result.locator.Path;
          var parsedpath = url.parse(path);
          parsedpath.pathname += '/' + filename;
          path = url.format(parsedpath);
          cb(err, {assetId: result.asset.Id, path: path, locatorId: result.locator.Id});
        }
      }.bind(this));
    }

    this.doneUpload = function (assetId, locatorId, cb) {
      async.waterfall([
        //delete upload location
        function (cb) {
          this.api.rest.locator.delete(locatorId, cb);
        }.bind(this),
        //generate file metadata
        function (cb) {
          this.generateMetadata(assetId, cb);
        }.bind(this),
      ], cb);
    }

    // TODO: support file larger than 64Mb
    this.uploadStream = function (filename, stream, length, done_cb) {
      this.getUploadUrl(filename, function(err, result) {
        //upload the stream
        var r = request.put({method: 'PUT', url: result.path, headers: {
            'Content-Type': 'application/octet-stream',
            'x-ms-blob-type': 'BlockBlob',
            'Content-Length': length
        }, strictSSL: true}, function (err, res) {
          this.doneUpload(result.assetId, result.locatorId, function(err){
            if (typeof done_cb !== 'undefined') {
                done_cb(err, result.assetId);
            }
          });
        }.bind(this));
        stream.pipe(r);
      }.bind(this));
    };

    this.downloadStream = function (assetId, stream, done_cb) {
        async.waterfall([
            function (cb) {
                this.api.rest.accesspolicy.findOrCreate(60, 1, function (err, result) {
                    cb(err, result);
                }.bind(this));
            }.bind(this),
            function (policy, cb) {
                this.api.rest.locator.create({AccessPolicyId: policy.Id, AssetId: assetId, StartTime: moment.utc().subtract(5, 'minutes').format('MM/DD/YYYY hh:mm:ss A'), Type: 1}, function (err, locator) {
                    cb(err, locator);
                }.bind(this));
            }.bind(this),
            function (locator, cb) {
                this.api.rest.assetfile.list(function (err, results) {
                    if (results.length > 0) {
                        cb(false, locator, results[0]);
                    } else {
                        cb("No files associated with asset.");
                    }
                }.bind(this), {$filter: "ParentAssetId eq '" + assetId +  "'", $orderby: 'Created desc', $top: 1});
            }.bind(this),
        ], function (err, locator, fileasset) {
            var path = locator.Path;
            var parsedpath = url.parse(path);
            parsedpath.pathname += '/' + fileasset.Name;
            path = url.format(parsedpath);
            request({
                uri: path,
                method: 'GET',
            }, function (err, res) {
                if (typeof done_cb !== 'undefined') {
                    done_cb(err);
                }
            }).pipe(stream);
        }.bind(this));
    };

    this.getUrl = function (assetId, duration, locatorType, done_cb) {
      async.waterfall([
        function (cb) {
          this.api.rest.accesspolicy.findOrCreate(duration, 1, function (err, result) {
            cb(err, result);
          }.bind(this));
        }.bind(this),
        function (policy, cb) {
			var data = {
					AccessPolicyId: policy.Id, 
					AssetId: assetId, 
					StartTime: moment.utc().subtract(4, 'minutes').toISOString(),
					Type: locatorType
				};
			if(locatorType == 2) {
				this.api.rest.locator.getOrCreate(data,cb);
			} else if (locatorType == 1) {
				this.api.rest.locator.deleteAndCreate(data,cb);
			} else {
				cb('unknown locator type');
			}		
        }.bind(this),
        function (locator, cb) {
          this.api.rest.assetfile.list(function (err, results) {
            if (results.length > 0) {
              cb(false, locator, results);
            } else {
              cb("No files associated with asset.");
            }
          }.bind(this), {$filter: "ParentAssetId eq '" + assetId + "'", $orderby: 'Created desc'});
        }.bind(this),
      ], function (err, locator, fileassets) {
        if (err) {
          done_cb(err);
          return;
        }
        var path = locator.Path;
		if (path.startsWith('http:')){ //set it to run over https			
			path = 'https'+path.substr(4);
		}		
		var thumbnails = [];
        var parsedpath = url.parse(path);			
        if (locatorType == 1) {
		  if(fileassets.length>1){			  
			  var imageextensions = ['.jpg','.png','.bmp'];
			  fileassets.forEach(function(file){
				if(includes(imageextensions, file.Name.substr(-4))){					
				  var thumbpath = url.parse(path);				  
				  thumbpath.pathname += '/' + file.Name;
				  var thumburl = url.format(thumbpath);
				  thumbnails.push(thumburl);
				} else if (file.Name.substr(-4) == '.mp4') {
				  parsedpath.pathname += '/' + file.Name;
				}  
			  });
		  } else {			
			parsedpath.pathname += '/' + fileassets[0].Name;
		  }
		}
        else if(locatorType == 2){
			fileassets.forEach(function(file){
				if(file.Name.substr(-4) == '.ism')
					parsedpath.pathname += file.Name+'/Manifest';
			});			
		}          
        else
          done_cb("unknow locatorType");
        path = url.format(parsedpath);
        done_cb(err, path, thumbnails);
      }.bind(this));
    }

    this.getDownloadURL = function (assetId, duration, done_cb) {
      if(arguments.length == 2) {
        done_cb = arguments[1];
        duration = 60;
      }
      this.getUrl(assetId, duration, 1, done_cb);
    };

    this.getOriginURL = function (assetId, duration, done_cb) {
      if(arguments.length == 2) {
        done_cb = arguments[1];
        duration = 60;
      }
      this.getUrl(assetId, duration, 2, done_cb);
    };    

    this.getThumbnails = function(assetId, duration, purgeSASLocators, done_cb){		
		if(arguments.length == 2) {
			done_cb = arguments[1];
			duration = 1440;
			purgeSASLocators = false;
		}		
		if(purgeSASLocators){
			this.api.rest.asset.listLocators(assetId, function(err, locators){
				if(!err && locators && locators.length>0){
					async.each(locators, function(locator, cb){
						if(locator.Type == 1){														
							this.api.rest.locator.delete(locator.Id, cb);						
						}				
					}, function(err){
						this.getUrl(assetId, duration, 1, function(err, path, thumbnails){
							if(!err && thumbnails && thumbnails.length>0){
								return done_cb(null, thumbnails)
							} else {
								return done_cb(err || 'No thumbnails found.');
							}
						});
					});
				} else {
					this.getUrl(assetId, duration, 1, function(err, path, thumbnails){
						if(!err && thumbnails && thumbnails.length>0){
							return done_cb(null, thumbnails)
						} else {
							return done_cb(err || 'No thumbnails found.');
						}
					});					
				}
			});			
		} else {
			this.getUrl(assetId, duration, 1, function(err, path, thumbnails){
				if(!err && thumbnails && thumbnails.length>0){
					return done_cb(null, thumbnails)
				} else {
					return done_cb(err || 'No thumbnails found.');
				}
			});
		}		
	}
	
	this.encodeVideo = function (assetId, mediaProcessor, encoder, callback) {
        async.waterfall([
            function (cb) {
                this.api.rest.mediaprocessor.getCurrentByName(mediaProcessor, cb);
            }.bind(this),
            function (processor, cb) {
                this.api.rest.asset.get(assetId, function (err, asset) {
                    cb(err, processor, asset);
                });
            }.bind(this),
            function (processor, asset, cb) {
                this.api.rest.job.create({
                    Name: 'EncodeVideo-' + uuid(),
                    InputMediaAssets: [{'__metadata': {uri: asset.__metadata.uri}}],
                    Tasks: [{
                        Configuration: encoder,
                        MediaProcessorId: processor.Id,
                        TaskBody: "<?xml version=\"1.0\" encoding=\"utf-8\"?><taskBody><inputAsset>JobInputAsset(0)</inputAsset><outputAsset>JobOutputAsset(0)</outputAsset></taskBody>"
                    }]
                }, function (err, job) {
                    cb(err, processor, asset, job);
                });
            }.bind(this),
        ], function (err, processor, asset, job) {
            callback(err, job, asset);
        });
    };


}).call(AzureBlob.prototype);

module.exports = AzureBlob;
