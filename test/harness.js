'use strict';

var couchbase = require('./../lib/couchbase');
var jcbmock = require('./jcbmock');
var fs = require('fs');
var util = require('util');
var assert = require('assert');
var semver = require('semver');

function ServerVersion(major, minor, patch, isMock) {
  this.major = major;
  this.minor = minor;
  this.patch = patch;
  this.isMock = isMock;
}

var ServerFeatures = {
  KeyValue: 'kv',
  Ssl: 'ssl',
  Views: 'views',
  SpatialViews: 'spatial_views',
  N1ql: 'n1ql',
  Subdoc: 'subdoc',
  Fts: 'fts',
  Analytics: 'analytics',
};

// We enable logging to ensure that logging doesn't break any of the tests,
// but we explicitly disable all output sources to avoid spamming anything.
couchbase.logging.enableLogging({
  console: false,
  filename: false
});

var config = {
  connstr: undefined,
  bucket: 'default',
  bpass: undefined,
  user: undefined,
  pass: undefined,
  muser: undefined,
  mpass: undefined,
  qhosts: undefined,
  version: new ServerVersion(0, 0, 0, false)
};

if (process.env.CNCSTR !== undefined) {
  config.connstr = process.env.CNCSTR;
}
if (process.env.CNCVER !== undefined) {
  assert(!config.connstr, 'must not specify a version without a connstr');
  var ver = process.env.CNCVER;
  var major = semver.major(ver);
  var minor = semver.minor(ver);
  var patch = semver.patch(ver);
  config.version = new ServerVersion(major, minor, patch, false);
}
if (process.env.CNQHOSTS !== undefined) {
  config.qhosts = process.env.CNQHOSTS;
}
if (process.env.CNBUCKET !== undefined) {
  config.bucket = process.env.CNBUCKET;
}
if (process.env.CNBPASS !== undefined) {
  config.bpass = process.env.CNBPASS;
}
if (process.env.CNUSER !== undefined) {
  config.user = process.env.CNUSER;
}
if (process.env.CNPASS !== undefined) {
  config.pass = process.env.CNPASS;
}
if (process.env.CNMUSER !== undefined) {
  config.muser = process.env.CNMUSER;
}
if (process.env.CNMPASS !== undefined) {
  config.mpass = process.env.CNMPASS;
}

var configWaits = [];

function _waitForConfig(callback) {
  if (!configWaits) {
    setImmediate(callback);
    return;
  }

  configWaits.push(callback);
  if (configWaits.length > 1) {
    return;
  }

  var _handleWaiters = function(err) {
    for (var i = 0; i < configWaits.length; ++i) {
      configWaits[i](err);
    }
    configWaits = null;
  };

  if (config.connstr) {
    _handleWaiters(null);
    return;
  }

  var mockVer = jcbmock.version();
  config.version =
    new ServerVersion(mockVer[0], mockVer[1], mockVer[2], true);

  before(function(done) {
    this.timeout(60000);

    jcbmock.create({}, function(err, mock) {
      if (err) {
        console.error('failed to start mock', err);
        process.exit(1);
        return;
      }

      config.mockInst = mock;
      config.connstr = 'http://localhost:' + mock.entryPort.toString();
      _handleWaiters(null);
      done();
    });
  });

  after(function(done) {
    config.mockInst.close();
    done();
  });
}

function _supportsFeature(feature) {
  switch (feature) {
    case ServerFeatures.KeyValue:
    case ServerFeatures.Ssl:
    case ServerFeatures.Views:
    case ServerFeatures.SpatialViews:
    case ServerFeatures.Subdoc:
      return true;
    case ServerFeatures.Fts:
    case ServerFeatures.N1ql:
    case ServerFeatures.Analytics:
      // supported on all versions except the mock
      return !config.version.isMock;
  }

  throw new Error('invalid code for feature checking');
}

function Harness() {
  this.keyPrefix = (new Date()).getTime();
  this.keySerial = 0;
}

Harness.prototype.requireFeature = function(feature, callback) {
  if (!_supportsFeature(feature)) {
    var oldIt = global.it;
    global.it = function(title, callback) {
      return oldIt(title);
    };
    callback();
    global.it = oldIt;
  } else {
    callback();
  }
}

Harness.prototype.key = function() {
  return 'tk-' + this.keyPrefix + '-' + this.keySerial++;
};

Harness.prototype.noCallback = function() {
  return function() {
    throw new Error('callback should not have been invoked');
  };
};

Harness.prototype.okCallback = function(target) {
  var stack = (new Error()).stack;
  return function(err, res) {
    if (err) {
      console.log(stack);
      console.log(err);
      assert(!err, err);
    }
    assert(typeof res === 'object', 'Result is missing');
    target(res);
  };
};

Harness.prototype.timeTravel = function(callback, period) {
  setTimeout(callback, period);
};

function MockHarness() {
  Harness.call(this);

  this.mockInst = null;
  this.connstr = 'couchbase://mock-server';
  this.bucket = 'default';
  this.qhosts = null;

  this.lib = couchbase.Mock;

  this.e = this.lib.errors;
  this.c = new this.lib.Cluster(this.connstr);
  this.b = this.c.openBucket(this.bucket);
  if (this.qhosts) {
    this.b.enableN1ql(this.qhosts);
  }

  this.mock = this;
}
util.inherits(MockHarness, Harness);

MockHarness.prototype.timeTravel = function(callback, period) {
  this.b.timeTravel(period);
  setImmediate(callback);
};

function RealHarness() {
  Harness.call(this);

  this.mock = new MockHarness();

  this.lib = couchbase;
  this.e = this.lib.errors;

  _waitForConfig(function() {
    this.mockInst = config.mockInst;
    this.connstr = config.connstr;
    this.bucket = config.bucket;
    this.user = config.user;
    this.pass = config.pass;
    this.qhosts = config.qhosts;
    this.bpass = config.bpass;
    this.muser = config.muser;
    this.mpass = config.mpass;

    this.c = new this.lib.Cluster(this.connstr);
    if (this.user || this.pass) {
      this.c.authenticate(this.user, this.pass);
    }
    this.b = this.c.openBucket(this.bucket);
    if (this.qhosts) {
      this.b.enableN1ql(this.qhosts);
    }
  }.bind(this));

  after(function() {
    if (this.b) {
      this.b.disconnect();
    }
  }.bind(this));
}
util.inherits(RealHarness, Harness);

RealHarness.prototype.timeTravel = function(callback, period) {
  if (!this.mockInst) {
    Harness.prototype.timeTravel.apply(this, arguments);
  } else {
    var periodSecs = Math.ceil(period / 1000);
    this.mockInst.command('TIME_TRAVEL', {
      Offset: periodSecs
    }, function(err) {
      if (err) {
        console.error('time travel error:', err);
      }

      callback();
    });
  }
};

var myHarness = new RealHarness();
myHarness.Features = ServerFeatures;
module.exports = myHarness;
