var path = require('path');
var modelName = path.basename(module.filename, '.js');

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
				var locator = locators.find(function(locator){
					return locator.Type==data.Type
				});
				this.rest.locator.delete(locator.toJSON().Id, function(err){
					this.rest.locator.create(data, cb);
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
