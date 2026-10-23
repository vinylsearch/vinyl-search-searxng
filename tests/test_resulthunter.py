"""Offline regression tests for the engine used by production album searches."""

import unittest

from lxml.html import fromstring
from searx.engines.resulthunter import _general_results
from searx.settings_loader import load_settings


def parse_cards(cards):
    return _general_results(fromstring(
        '<div class="organic-results-container"><div>' + cards + '</div></div>'
    ))


class ResultHunterLinksTest(unittest.TestCase):
    def test_one_product_url_despite_icon_and_sitelinks(self):
        results = parse_cards('''
          <div class="group">
            <a href="https://www.ebay.de/"><img alt="Shop icon"></a>
            <a href="https://www.ebay.de/itm/123456789012">
              <h3>Pink Floyd – The Wall Vinyl</h3>
            </a>
            <p>Double LP album.</p>
            <a href="https://www.ebay.de/b/Musik/11233">Music</a>
            <a href="https://www.ebay.de/itm/999999999999"><h3>Related album</h3></a>
          </div>
        ''')
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].url, 'https://www.ebay.de/itm/123456789012')
        self.assertEqual(results[0].title, 'Pink Floyd – The Wall Vinyl')
        self.assertEqual(results[0].content, 'Double LP album.')

    def test_separate_cards_preserve_their_own_links(self):
        results = parse_cards('''
          <div class="group"><a href="https://www.jpc.de/product/1">
            <h3>Genesis Foxtrot CD</h3></a></div>
          <div class="group"><a href="https://www.medimops.de/foxtrot.html">
            <span><h3>Genesis Foxtrot CD used</h3></span></a></div>
        ''')
        self.assertEqual([r.url for r in results], [
            'https://www.jpc.de/product/1',
            'https://www.medimops.de/foxtrot.html',
        ])
        self.assertEqual(results[1].title, 'Genesis Foxtrot CD used')

    def test_cards_without_a_product_headline_do_not_become_results(self):
        results = parse_cards('''
          <div class="group"><a href="https://www.ebay.de/">Navigation</a></div>
          <div class="group"><a><h3>No destination</h3></a></div>
        ''')
        self.assertEqual(len(results), 0)

    def test_only_result_hunter_enabled_for_general_search(self):
        settings, _ = load_settings()
        enabled = []
        for engine in settings['engines']:
            categories = engine.get('categories', [])
            if isinstance(categories, str):
                categories = [c.strip() for c in categories.split(',')]
            if ('general' in categories and not engine.get('disabled', False)
                    and not engine.get('inactive', False)):
                enabled.append(engine['name'])
        self.assertEqual(enabled, ['resulthunter'])
        self.assertIn('json', settings['search']['formats'])
        self.assertEqual(settings['outgoing']['request_timeout'], 6.0)
        self.assertEqual(settings['outgoing']['max_request_timeout'], 10.0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
