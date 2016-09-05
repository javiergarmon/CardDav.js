
//Modules
	var async      = require('async');
	var tools      = require('./tools.js');
	var fs         = require('fs');
	var path	   = require('path');
	var Handlebars = require('handlebars');
	var vCard      = require('vcards-js');
	var vcardparser = require('vcardparser');
	var _ 		   = require("lodash");
	_.mixin(require("lodash-deep"));

//Global Variables
	var templates = {};

//Private functions
	(function loadTemplates(){
		
		var files = fs.readdirSync(__dirname + '/templates');

		files.forEach(function(templateDir){
			templates[templateDir] = fs.readFileSync(__dirname + '/templates/' + templateDir, {encoding : 'utf8'});
			templates[templateDir] = Handlebars.compile(templates[templateDir]);
		});

	})();

//Public functions

	var Sync = function( config ){
		this.config = config;
		this.protocol
	};

	Sync.prototype.createAddressbook = function( path, info, callback ){

		if(!path){
			return callback({err : "Error: path required"});
		}
		
		var body = templates['newAddressbook'](info);
		path = path + tools.uuid() + '/';

		this.request('MKCOL', path, body, function (err, res) {

			if (err || res.statusCode !== 201) {
				callback({err : err, statusCode : res.statusCode});
				return;
			}

			callback(null, path);
		});
	};

	Sync.prototype.modifyAddressbook = function( path, info, callback ){

		if(!path){
			return callback({err : "Error: path required"});
		}
		
		var body = templates['modifyAddressbook'](info);

		this.request('PROPPATCH', path, body, function (err, res) {

			if (err) {
				callback({err : err});
				return;
			}

			callback(null, path);
		});
	};

	Sync.prototype.createContact = function ( path, info, callback ) {

		tools.filterContactInfo(info);

		var body = _.extend(vCard(), info);
		body = body.getFormattedString();

		path = path + tools.uuid() + '.vcf';

		this.request( 'PUT', {
			path : path, 
			headers : {
				'If-None-Match' : '*',
				'Content-Type': 'text/vcard; charset=utf-8'
			}}, body, function (err, res) {
				
				console.log( res.statusCode, body );

			
			if (err || res.statusCode !== 201) {
				callback({err : err, statusCode : res.statusCode});
				return;
			}

			callback(null, path);
		});
	};

	Sync.prototype.deleteAddressbook = function ( path, callback ) {

		this.request('DELETE', path, '', function (err, res) {
			callback(err);
		});

	};

	Sync.prototype.deleteContact = function ( path, callback ) {

		this.request('DELETE', path, '', function (err, res) {
			callback(err);
		});

	};

	Sync.prototype.getAddressbooks = function( calHome, callback ){

		var body = templates['getAddressbooks']();

		this.request( 'PROPFIND', { path : calHome, depth : 1 }, body, function( error, res ){

			tools.parseXML( res.body, function ( err, data ){

				if( err ){
					return callback( err );
				}

				var addressbooks = _.map(data.response, function(internal){
					var newObj = {};
					newObj.href = internal.href;
					newObj = _.extend(newObj, _.deepGet(internal, 'propstat[0].prop[0]'));
					newObj = _.reduce(newObj, tools.normalizeAddressbookAttribute, {});
					return newObj;
				});

				addressbooks = _.filter(addressbooks, function(item){
					return item.resourcetype.indexOf('addressbook') !== -1;
				});

				callback(null, addressbooks);

			});

		});

	};

	Sync.prototype.getContact = function( path, callback ){

		this.request( 'GET', path, '', function( error, res ){

			if(error || res.statusCode !== 200){
				return callback('UNABLE TO RETRIEVE CONTACT');
			}

			vcardparser.parseString(res.body, function(err, json) {

			    if(err) {
			    	return callback(err);
			    }

				callback( null, json);
			});
							
		});

	};

	Sync.prototype.login = function( callback ){

		this.request( 'OPTIONS', '', '', function( error, res ){

			if(error){
				callback(true);
			}
			else {
				callback(null, res.statusCode === 200);
			}

		});
		
	};

	Sync.prototype.getHome = function( callback ){

		this.request( 'PROPFIND', '', templates['getHome'](), function( error, res ){

			tools.parseXML( res.body, function( err, data ){

				if( err ){
					return callback( err );
				}

				callback(null, _.deepGet(data, 'response[0].propstat[0].prop[0].current-user-principal[0].href[0]'));

			});

		});
		
	};

	Sync.prototype.getAddressbookHome = function( home, callback ){

		this.request( 'PROPFIND', home, templates['getAddressbookHome'](), function( err, res ){

			tools.parseXML( res.body, function( err, data ){

				if( err ){
					return callback( err );
				}

				callback(null, _.deepGet(data, 'response[0].propstat[0].prop[0].addressbook-home-set[0].href[0]'));

			});

		});

	};

	Sync.prototype.getContacts = function ( filter, path, callback ) {

		filter = filter || {};

		var body = templates['getContacts'](filter);
		body = body.replace(/^\s*$[\n\r]{1,}/gm, '');

		this.request('REPORT', { path : path, depth : 1 }, body, function (err, res) {

			if (err) {
				callback(err);
				return;
			}

			tools.parseXML( res.body, function ( err, data ) {

				if (err) {
					return callback(err);
				}

				if(!data || !data.response){
					return callback(null, []);
				}

				async.map(data.response, function(internal, callback){

					var newObj = {};
					newObj.href = internal.href;

					newObj = _.extend(newObj, _.deepGet(internal, 'propstat[0].prop[0]'));
					newObj = _.reduce(newObj, tools.normalizeAddressbookAttribute, {});

					vcardparser.parseString(newObj['address-data'], function(err, json) {

					    if(err) {
					    	return callback(err);
					    }

					    newObj['address-data'] = json;
						callback( null, newObj );
					});

				}, callback);

			});

		});

	};

	Sync.prototype.modifyContact = function ( path, info, callback ) {

		tools.filterContactInfo(info);
		var that = this;

		that.request( 'GET', path, '', function( error, res ){

			if(error || res.statusCode !== 200){
				return callback('UNABLE TO RETRIEVE CONTACT');
			}

			var etag = res.headers.etag;

			var body = _.extend(vCard(), info);
			body = body.getFormattedString();

			that.request( 'PUT', {
				path : path, 
				headers : {
					'If-Match' : etag,
					'Content-Type': 'text/vcard; charset=utf-8'
				}}, body, function (err, res) {

				
				if (err || res.statusCode !== 204) {
					callback({err : err, statusCode : res.statusCode});
					return;
				}

				callback(null, path);
			});
							
		});

	};


	Sync.prototype.request = function( type, path, body, callback ){

		var opts = {

			host    : this.config.host,
			path    : typeof path === 'string' ? path || '' : path.path || '',
			method  : type,
			data    : body,
			port    : this.config.port || 5232,
			headers : {

				'brief'           : 't',
				'accept-language' : 'es-es',
				'accept-encoding' : 'gzip, deflate',
				'connection'      : 'keep-alive',
				'user-agent'      : 'Inevio CalDAV Client',
	  			'prefer'          : 'return=minimal',
				'Accept'          : '*/*',
				'Content-Type'    : 'text/xml',
				'Content-Length'  : body.length,
				'Depth'           : path.depth || 0,
				'Authorization'   : 'Basic ' + new Buffer( this.config.credentials.user + ':' + this.config.credentials.password ).toString('base64')

			}
		};	

		if(path.headers){
			opts.headers = _.extend(opts.headers, path.headers);
		}

		var self = this;

		tools.request( opts, this.config.secure, function( err, res ){
			
			if( err ){
				return callback( err );
			}else if( res.statusCode === 302 ){
				self.request( type, res.headers.location, body, callback );
			}else{
				callback( null, res );
			}


		});

	};

	module.exports = Sync;
