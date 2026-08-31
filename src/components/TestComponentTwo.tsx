import React from 'react';

const TestComponentTwo: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-6">
      <h1 className="text-4xl font-bold mb-4">Test Component Two</h1>
      <p className="text-lg text-gray-300">
        This component confirms integration with the master branch.
      </p>
      <div className="mt-8 p-4 bg-blue-600 rounded-lg shadow-lg">
        <p className="text-sm font-mono">Status: Integration Verified</p>
      </div>
    </div>
  );
};

export default TestComponentTwo;