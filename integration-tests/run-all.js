#!/usr/bin/env node

/**
 * Main Integration Test Runner
 * Runs all component integration tests
 */

const { testAuth } = require('./auth.test');
const { testDatabase } = require('./database.test');
const { testStorage } = require('./storage.test');
const { testAI } = require('./ai.test');

async function runAllTests() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 INSFORGE SDK INTEGRATION TESTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const tests = [
    { name: 'Auth', fn: testAuth },
    { name: 'Database', fn: testDatabase },
    { name: 'Storage', fn: testStorage },
    { name: 'AI', fn: testAI }
  ];

  const results = [];

  for (const test of tests) {
    try {
      await test.fn();
      results.push({ name: test.name, passed: true });
    } catch (error) {
      console.error(`\n❌ ${test.name} Module: Failed`);
      console.error(`   Error: ${error.message}\n`);
      results.push({ name: test.name, passed: false, error: error.message });
    }
  }

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 TEST SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  results.forEach(result => {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.name} Module`);
    if (result.error) {
      console.log(`   └─ ${result.error}`);
    }
  });

  console.log(`\nTotal: ${passed}/${total} modules passed`);

  if (passed === total) {
    console.log('\n🎉 All integration tests passed!');
    process.exit(0);
  } else {
    console.log(`\n⚠️  ${total - passed} module(s) failed`);
    process.exit(1);
  }
}

// Run tests if executed directly
if (require.main === module) {
  runAllTests().catch(error => {
    console.error('💥 Test runner crashed:', error);
    process.exit(1);
  });
}

module.exports = { runAllTests };