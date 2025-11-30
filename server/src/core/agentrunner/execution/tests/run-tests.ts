// path: core/workflowrunner/execution/tests/run-tests.ts

import ChannelIntegrationTest from './channel-integration-test';
import logger from '../../../../utils/logger';

/**
 * Test Runner for Channel Integration
 * 
 * This script runs all the channel integration tests and provides
 * detailed output about the results.
 */

async function runChannelIntegrationTests() {
  console.log('🚀 Starting Channel Integration Test Runner');
  console.log('==========================================\n');

  try {
    const testSuite = new ChannelIntegrationTest();
    await testSuite.runAllTests();

    const results = testSuite.getTestResults();
    const passedTests = results.filter(r => r.success).length;
    const totalTests = results.length;

    console.log('\n🎯 Final Results:');
    console.log('================');
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${totalTests - passedTests}`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

    if (passedTests === totalTests) {
      console.log('\n🎉 All tests passed! Channel integration is working correctly.');
      process.exit(0);
    } else {
      console.log('\n⚠️  Some tests failed. Check the logs above for details.');
      process.exit(1);
    }

  } catch (error) {
    logger.error('Test runner failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    console.log('\n❌ Test runner encountered an error:', error);
    process.exit(1);
  }
}

// Run the tests
runChannelIntegrationTests();
