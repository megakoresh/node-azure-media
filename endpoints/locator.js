var path = require('path');
var modelName = path.basename(module.filename, '.js');
var moment = require('moment');

var calls = {

    create: function (data, cb) {
        this.createRequest(modelName, data, cb);
    },

    get: function (id, cb) {
        this.getRequest(modelName, id, cb);
    },

    list: function (cb) {
        this.listRequest(modelName, cb);
    },

    update: function (id, data, cb) {
        this.updateRequest(modelName, id, data, cb);
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
					console.log('Deleting locator with expiration date \n'+
					moment(parseInt(locator.ExpirationDateTime.match(/[0-9]+/)[0])).format("DD.MM.YYYY hh:mm:ss"));
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
    }
};

module.exports = calls;
