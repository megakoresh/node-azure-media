var path = require('path');
var modelName = path.basename(module.filename, '.js');
var moment = require('moment');
var request = require('request');
var models = require('../models');

var calls = {

    create: function (data, cb, prevent409) {
		data.Name = "NodeAzureMedia_"+data.StartTime;
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
				//console.log('Found '+locators.length+' updatable locators');				
				var fittingLocator;
				async.each(locators, 
					function checkLocator(locator, processedLocator){
						//console.log(locator.toJSON());
						var et = moment.utc(parseInt(locator.ExpirationDateTime.match(/[0-9]+/)[0])).add(1, 'minutes'); //add some leeway, this is a parallel operation after all						
						//console.log('Old expiration date is '+et.toISOString());
						var st = moment.utc(parseInt(locator.StartTime.match(/[0-9]+/)[0]));
						//console.log('Start time is '+st.toISOString());
						var now = moment.utc();
						//console.log('System time: '+now.toISOString());
						var age = now.diff(st, 'hours', true);
						//console.log('Age: '+age);
						if(age > 24 || et.isBefore(now)){ //if it already expired, don't extend
							//console.log('Older than a day or expired, removing.');
							this.rest.locator.delete(locator.toJSON().Id, processedLocator);
						} else {
							var duration = et.diff(st, 'minutes', true);
							//console.log('Duration:  '+duration);
							if(et.diff(now, 'minutes', true) > 60){ //no need to extend more. TODO: make this value customizable
								console.log('No need to extend, returning');
								fittingLocator = locator;
								processedLocator('OK');
							} else {
								var newLocatorData = locator.toJSON();
								newLocatorData.ExpirationDateTime = et.add(duration, 'minutes').toISOString();
								//console.log('New expiration date is '+newLocatorData.ExpirationDateTime);
								newLocatorData.StartTime = st.toISOString(); //have to convert for the validator...
								//console.log('Using existing locator. Extending duration.');															
								this.rest.locator.update(locator.toJSON().Id, newLocatorData, function(err, updated){
									if(err) console.log('Error updating locator: \n'+err);
									fittingLocator = updated;
									processedLocator('OK');
								});
							}
						}
					}.bind(this), 
					function checkedAllLocators(err){
						if(err && err != 'OK') console.log(err);
						if(err == 'OK' && fittingLocator){
							//console.log('Using existing locator');
							cb(null, fittingLocator);
						} else {
							//console.log('Creating new locator');
							this.rest.locator.create(data,cb, true);
						}
				}.bind(this));
			} else {
				//console.log('No locators of this type found for the asset. Creating new one');
				this.rest.locator.create(data,cb, true);
			}
		}.bind(this), {$filter: "Type eq "+data.Type+" and AssetId eq '"+data.AssetId+"'", $orderby: 'StartTime asc'})
	}
};

module.exports = calls;
