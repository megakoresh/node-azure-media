var path = require('path');
var modelName = path.basename(module.filename, '.js');
var moment = require('moment');
var request = require('request');
var models = require('../models');

var calls = {

    create: function (data, cb, prevent409) {
		data.Name = "NodeAzureMedia_"+data.Type+"_"+data.AssetId;
        this.createRequest(modelName, data, function(err, locator){
			if(err){
				if(prevent409 && (typeof err === 'string') && err.match(/received: 409/)){
					this.rest.asset.removeAllLocatorsOfType(data.AssetId, data.Type, function(err){
						if(!err){
							this.rest.locator.create(data, function(err, locator){
								cb(err, locator);
							});
						} else {
							cb(err);
						}
					}.bind(this));
				} else {
					cb(err);
				}
			} else {
				cb(null, locator);
			}
		}.bind(this));
    },

    get: function (id, cb) {
        this.getRequest(modelName, id, cb);
    },

    list: function (cb, query) {
		query = query || '';
        this.listRequest(modelName, cb, query);
    },

    update: function (id, ldata, cb) {
        cb = cb || function () {};

        var pl = models[modelName].create(ldata);
        var validationErrors = pl.doValidate();
        if (validationErrors.length) {
            return cb(validationErrors);
        }
        request({
            method: 'MERGE',
            uri: this.modelURI(modelName, id),
            headers: this.defaultHeaders(),
            followRedirect: false,
            strictSSL: true,
            body: JSON.stringify(ldata)
        }, function (err, res) {
          if (err) return cb(err);
          if (res.statusCode == 204 || res.statusCode == 200) {
			  if(res.statusCode == 204){
				  console.log(res.body);
				  cb(err, models[modelName].create(ldata));
			  } else {
				var data = JSON.parse(res.body).d;
				var dobj = models[modelName].create(data);  
				cb(err, dobj);
			  }              
          } else {
              cb(err || 'Update ' + modelName + ': Expected 204 or 200 status, received: ' + res.statusCode + '\n' + res.body);
          }
        }.bind(this));
    },

    delete: function (id, cb) {
        this.deleteRequest(modelName, id, cb);
    },

    deleteAndCreate: function (data, cb) {
      this.rest.asset.listLocators(data.AssetId, function (err, locators) {
        if(!err && locators.length > 0) {			
			var type = locators.filter(function(l){
				return l.Type == data.Type;
			});
			if(type.length > 0){
				async.each(type, function(locator, cb1){
					//console.log('Deleting locator with expiration date \n'+
					//moment(parseInt(locator.ExpirationDateTime.match(/[0-9]+/)[0])).format("DD.MM.YYYY hh:mm:ss"));
					this.rest.locator.delete(locator.toJSON().Id, function(err){
						if(err) console.log(err);
						cb1();
					});
				}.bind(this), function removed(err){
					this.rest.locator.create(data, function(err, locator){
						if(err){
							console.log(err);
							cb(err);
						} else {
							cb(null, locator);
						}
					});
				}.bind(this));
			} else {
				this.rest.locator.create(data, cb);
			}			
        }
        else{
			this.rest.locator.create(data, cb);          
        }
      }.bind(this));
    },
	getOrCreate: function(data, cb) {
		this.rest.locator.list(function(err, locators){
			if(!err && data.Type==2 && locators.length>0){
				console.log('Found '+locators.length+' updatable locators');				
				var fittingLocator;
				async.each(locators, 
					function checkLocator(locator, processedLocator){
						console.log(locator.toJSON());
						var et = moment.utc(parseInt(locator.ExpirationDateTime.match(/[0-9]+/)[0]));
						var st = moment.utc(parseInt(locator.StartTime.match(/[0-9]+/)[0]));
						var now = moment.utc();
						var diff = st.diff(now, 'hours', true);					
						if(diff > 24){
							console.log('Older than a day, removing.');
							this.rest.locator.delete(locator.toJSON().Id, processedLocator);
						} else {
							var duration = st.diff(et, 'minutes', true);							
							var newLocatorData = locator.toJSON();
							newLocatorData.ExpirationDateTime = moment().utc(data.StartTime).add(duration, 'minutes').toISOString();
							newLocatorData.StartTime = st.toISOString();
							console.log('Using existing locator. Extending duration.');
							console.log('Old expiration date is '+et.toISOString());
							console.log('New expiration date is '+newLocatorData.ExpirationDateTime);											
							console.log('Start time is '+st.toISOString());
							this.rest.locator.update(locator.toJSON().Id, newLocatorData, function(err, updated){
								if(err) console.log('Error updating locator: '+err);
								fittingLocator = updated;
								processedLocator('OK');
							});
						}
					}.bind(this), 
					function checkedAllLocators(err){
						if(err && err != 'OK') console.log(err);
						if(err == 'OK' && fittingLocator){
							console.log('Using existing locator');
							cb(null, fittingLocator);
						} else {
							console.log('Creating new locator');
							this.rest.locator.create(data,cb, true);
						}
				}.bind(this));
			} else {
				console.log('No locators of this type found for the asset. Creating new one');
				this.rest.locator.create(data,cb, true);
			}
		}.bind(this), {$filter: "Type eq "+data.Type+" and AssetId eq '"+data.AssetId+"'", $orderby: 'StartTime asc'})
	}
};

module.exports = calls;
