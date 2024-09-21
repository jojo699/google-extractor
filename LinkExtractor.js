import React, { useState, useEffect } from 'react';
import { AlertCircle, ExternalLink, Search, Loader, Mail, Phone } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';

const GoogleEmailExtractor = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalSites, setTotalSites] = useState(0);
  const [processedSites, setProcessedSites] = useState(0);

  const extractLinksAndEmails = async () => {
    try {
      setError('');
      setResults([]);
      setLoading(true);
      setProgress(0);
      setTotalSites(0);
      setProcessedSites(0);

      const response = await fetch(`http://localhost:3001/api/extract-google-links-and-emails?query=${encodeURIComponent(query)}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            if (data.done) {
              setLoading(false);
              setProgress(100);
            } else if (data.result) {
              setResults(prev => [...prev, data.result]);
              setProcessedSites(prev => prev + 1);
            } else if (data.totalSites) {
              setTotalSites(data.totalSites);
            }
          }
        }
      }

      // Fetch JSON late
      const jsonResponse = await fetch(`http://localhost:3001/api/get-final-results`);
      if (!jsonResponse.ok) {
        throw new Error('fetch failed');
      }
      const finalResults = await jsonResponse.json();
      console.log('output JSON:', finalResults);
      
    } catch (err) {
      setError(err.message || 'error extracting data.');
      setLoading(false);
    }
  };

  useEffect(() => {
    if (totalSites > 0) {
      setProgress((processedSites / totalSites) * 100);
    }
  }, [processedSites, totalSites]);

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Google Search Results, Email, and Phone Number Extractor</h1>
      <div className="mb-6">
        <div className="flex items-center mb-3">
          <Search className="h-5 w-5 mr-2 text-gray-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter your Google search query"
            className="flex-grow p-3 border rounded text-lg"
            onKeyPress={(e) => e.key === 'Enter' && extractLinksAndEmails()}
          />
        </div>
        <button
          onClick={extractLinksAndEmails}
          disabled={loading || !query}
          className="w-full bg-blue-600 text-white px-6 py-3 rounded text-lg font-semibold hover:bg-blue-700 disabled:bg-blue-300 transition duration-200 flex items-center justify-center"
        >
          {loading ? (
            <>
              <Loader className="animate-spin mr-2" />
              Extracting...
            </>
          ) : (
            'Extract Links, Emails, and Phone Numbers'
          )}
        </button>
      </div>
      {loading && (
        <div className="mb-4">
          <Progress value={progress} className="w-full" />
          <p className="text-center mt-2">Extracting data... {processedSites}/{totalSites} sites processed.</p>
        </div>
      )}
      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {results.length > 0 && (
        <div className="mt-6">
          <h2 className="text-2xl font-semibold mb-4">Extracted Results: {results.length}</h2>
          <ul className="space-y-6 max-h-96 overflow-y-auto pr-4">
            {results.map((result, index) => (
              <li key={index} className="border-b pb-4">
                <div className="flex items-start mb-2">
                  <ExternalLink className="h-5 w-5 mr-2 mt-1 flex-shrink-0" />
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline break-all"
                  >
                    <span className="font-medium">{result.text}</span>
                  </a>
                </div>
                {result.emails.length > 0 && (
                  <div className="ml-7">
                    <p className="text-sm font-semibold mb-1">Emails found:</p>
                    <ul className="list-disc pl-5">
                      {result.emails.map((email, emailIndex) => (
                        <li key={emailIndex} className="flex items-center">
                          <Mail className="h-4 w-4 mr-2" />
                          <span className="text-green-600">{email}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.phoneNumbers.length > 0 && (
                  <div className="ml-7 mt-2">
                    <p className="text-sm font-semibold mb-1">Phone numbers found:</p>
                    <ul className="list-disc pl-5">
                      {result.phoneNumbers.map((phone, phoneIndex) => (
                        <li key={phoneIndex} className="flex items-center">
                          <Phone className="h-4 w-4 mr-2" />
                          <span className="text-blue-600">{phone}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default GoogleEmailExtractor;
