'use strict';

var assert = require('assert');
var harness = require('./harness.js');

describe('#crud', function() {
  function allTests(H) {
    it('should properly round-trip binary', function(done) {
      var key = H.key();
      var data = Buffer.from([3, 2, 4, 1]);
      H.b.insert(key, data, H.okCallback(function() {
        H.b.get(key, H.okCallback(function(res) {
          assert(Buffer.isBuffer(res.value));
          assert.deepEqual(res.value, data);
          done();
        }));
      }));
    });
    it('should properly round-trip json', function(done) {
      var key = H.key();
      var data = { x: 1, y: { z: 2 } };
      H.b.insert(key, data, H.okCallback(function() {
        H.b.get(key, H.okCallback(function(res) {
          assert.deepEqual(res.value, data);
          done();
        }));
      }));
    });
    it('should properly round-trip text', function(done) {
      var key = H.key();
      var data = 'foo';
      H.b.insert(key, data, H.okCallback(function() {
        H.b.get(key, H.okCallback(function(res) {
          assert.deepEqual(res.value, data);
          done();
        }));
      }));
    });
    it('should call custom transcoders', function(done) {
      var bucket = H.c.openBucket(H.bucket);
      var encoderCalled = false;
      var decoderCalled = false;
      bucket.setTranscoder(function(doc) {
        encoderCalled = true;
        return { value: doc, flags: 0 };
      }, function(doc) {
        decoderCalled = true;
        return doc.value;
      });
      // test object much be binary to be inserted by binding
      var data = Buffer.from('test', 'utf8');
      var key = H.key();
      bucket.insert(key, data, H.okCallback(function() {
        bucket.get(key, H.okCallback(function() {
          assert(encoderCalled);
          assert(decoderCalled);

          bucket.disconnect();
          done();
        }));
      }));
    });
    it('should fallback to binary for bad flags', function(done) {
      var bucket = H.c.openBucket(H.bucket);
      var encoderCalled = false;
      bucket.setTranscoder(function(doc) {
        encoderCalled = true;
        return { value: doc, flags: 50000 };
      });
      var data = Buffer.from('test', 'utf8');
      var key = H.key();
      bucket.insert(key, data, H.okCallback(function() {
        assert(encoderCalled);
        bucket.get(key, H.okCallback(function(res) {
          assert(Buffer.isBuffer(res.value));

          bucket.disconnect();
          done();
        }));
      }));
    });
  }

  describe('#RealBucket', allTests.bind(this, harness));
  describe('#MockBucket', allTests.bind(this, harness.mock));
});
