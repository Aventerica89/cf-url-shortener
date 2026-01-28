// LinkShort Mobile App - Expo Snack Demo v2
// Matches the mockup design at links.jbcloud.app/mobile-mockup
// Paste this entire file into App.js at https://snack.expo.dev

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

// Design tokens (matching mockup exactly)
const colors = {
  background: '#0a0a0a',
  foreground: '#fafafa',
  card: '#171717',
  muted: '#262626',
  mutedForeground: '#a1a1aa',
  border: '#262626',
  indigo: '#818cf8',
  indigoBg: 'rgba(129,140,248,0.15)',
  green: '#22c55e',
  categories: {
    work: { bg: 'rgba(167,139,250,0.15)', text: '#a78bfa' },
    social: { bg: 'rgba(34,211,238,0.15)', text: '#22d3ee' },
    marketing: { bg: 'rgba(251,146,60,0.15)', text: '#fb923c' },
    personal: { bg: 'rgba(236,72,153,0.15)', text: '#ec4899' },
  },
};

// Mock data
const MOCK_LINKS = [
  {
    code: 'portfolio',
    destination: 'https://example.com/my-portfolio-2024',
    clicks: 1234,
    category_name: 'Work',
    category_color: 'work',
    created_at: '2026-01-26T10:00:00Z',
  },
  {
    code: 'twitter',
    destination: 'https://twitter.com/username',
    clicks: 856,
    category_name: 'Social',
    category_color: 'social',
    created_at: '2026-01-23T14:30:00Z',
  },
  {
    code: 'promo',
    destination: 'https://producthunt.com/posts/app',
    clicks: 2341,
    category_name: 'Marketing',
    category_color: 'marketing',
    created_at: '2026-01-21T09:15:00Z',
  },
  {
    code: 'blog',
    destination: 'https://blog.jbcloud.app/latest-post',
    clicks: 445,
    category_name: 'Personal',
    category_color: 'personal',
    created_at: '2026-01-25T16:45:00Z',
  },
  {
    code: 'github',
    destination: 'https://github.com/yourusername',
    clicks: 678,
    category_name: 'Work',
    category_color: 'work',
    created_at: '2026-01-24T11:00:00Z',
  },
];

// Stats Card Component (matching mockup)
function StatsCard({ value, label, change }) {
  const formatNumber = (num) => {
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  return (
    <View style={styles.statsCard}>
      <Text style={styles.statsValue}>{formatNumber(value)}</Text>
      <Text style={styles.statsLabel}>{label}</Text>
      <Text style={styles.statsChange}>{change}</Text>
    </View>
  );
}

// Link Card Component (matching mockup design)
function LinkCard({ link, onPress }) {
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return '1d ago';
    if (diffDays < 7) return `${diffDays}d ago`;
    return `${Math.floor(diffDays / 7)}w ago`;
  };

  const formatClicks = (num) => {
    if (num >= 1000) return (num / 1000).toFixed(0) + ',' + (num % 1000).toString().padStart(3, '0').slice(0, 3);
    return num.toLocaleString();
  };

  const getCategoryStyle = (colorName) => {
    return colors.categories[colorName] || { bg: colors.muted, text: colors.mutedForeground };
  };

  const catStyle = getCategoryStyle(link.category_color);

  return (
    <TouchableOpacity style={styles.linkCard} onPress={onPress} activeOpacity={0.7}>
      {/* Link code badge */}
      <View style={styles.linkHeader}>
        <View style={styles.linkCodeBadge}>
          <Text style={styles.linkCodeText}>/{link.code}</Text>
        </View>
      </View>

      {/* Destination URL */}
      <Text style={styles.linkUrl} numberOfLines={1}>
        {link.destination}
      </Text>

      {/* Footer: clicks, date, category */}
      <View style={styles.linkFooter}>
        <View style={styles.linkMeta}>
          <Text style={styles.linkClicks}>{formatClicks(link.clicks)} clicks</Text>
          <Text style={styles.linkDate}>{formatDate(link.created_at)}</Text>
        </View>
        <View style={[styles.categoryBadge, { backgroundColor: catStyle.bg }]}>
          <Text style={[styles.categoryText, { color: catStyle.text }]}>
            {link.category_name}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// Main App
export default function App() {
  const [links] = useState(MOCK_LINKS);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('links');

  const totalLinks = 128;
  const totalClicks = 4800;

  const filteredLinks = links.filter(
    (l) =>
      l.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.destination.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleLinkPress = (link) => {
    Alert.alert(link.code, `Destination: ${link.destination}\nClicks: ${link.clicks}`);
  };

  const renderHeader = () => (
    <View style={styles.header}>
      {/* Stats row */}
      <View style={styles.statsRow}>
        <StatsCard value={totalLinks} label="Total Links" change="+12 this week" />
        <StatsCard value={totalClicks} label="Total Clicks" change="+523 today" />
      </View>

      {/* Section header */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Links</Text>
        <TouchableOpacity>
          <Text style={styles.sectionAction}>See All</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* App header */}
      <View style={styles.appHeader}>
        <Text style={styles.appTitle}>Links</Text>
        <TouchableOpacity style={styles.headerBtn}>
          <Feather name="bell" size={20} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <Feather name="search" size={18} color={colors.mutedForeground} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search links..."
          placeholderTextColor={colors.mutedForeground}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Feather name="x" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {/* Links list */}
      <FlatList
        data={filteredLinks}
        keyExtractor={(item) => item.code}
        renderItem={({ item }) => (
          <LinkCard link={item} onPress={() => handleLinkPress(item)} />
        )}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      />

      {/* Tab bar (matching mockup) */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={styles.tab}
          onPress={() => setActiveTab('links')}
        >
          <Feather
            name="link"
            size={20}
            color={activeTab === 'links' ? colors.indigo : colors.mutedForeground}
          />
          <Text style={[styles.tabLabel, activeTab === 'links' && styles.tabLabelActive]}>
            Links
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tab}
          onPress={() => setActiveTab('analytics')}
        >
          <Feather
            name="bar-chart-2"
            size={20}
            color={activeTab === 'analytics' ? colors.indigo : colors.mutedForeground}
          />
          <Text style={[styles.tabLabel, activeTab === 'analytics' && styles.tabLabelActive]}>
            Analytics
          </Text>
        </TouchableOpacity>

        {/* Center add button - gradient rounded square */}
        <TouchableOpacity
          style={styles.tabAddContainer}
          onPress={() => Alert.alert('Create Link', 'This would open the create link form')}
        >
          <View style={styles.tabAddBtn}>
            <Feather name="plus" size={26} color="#fff" />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tab}
          onPress={() => setActiveTab('categories')}
        >
          <Feather
            name="grid"
            size={20}
            color={activeTab === 'categories' ? colors.indigo : colors.mutedForeground}
          />
          <Text style={[styles.tabLabel, activeTab === 'categories' && styles.tabLabelActive]}>
            Categories
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tab}
          onPress={() => setActiveTab('settings')}
        >
          <Feather
            name="sun"
            size={20}
            color={activeTab === 'settings' ? colors.indigo : colors.mutedForeground}
          />
          <Text style={[styles.tabLabel, activeTab === 'settings' && styles.tabLabelActive]}>
            Settings
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  appHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  appTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.foreground,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.muted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.muted,
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 44,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    color: colors.foreground,
    fontSize: 15,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  statsCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  statsValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.foreground,
  },
  statsLabel: {
    fontSize: 12,
    color: colors.mutedForeground,
  },
  statsChange: {
    fontSize: 11,
    color: colors.green,
    marginTop: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.foreground,
  },
  sectionAction: {
    fontSize: 14,
    color: colors.indigo,
  },
  linkCard: {
    backgroundColor: colors.card,
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  linkHeader: {
    marginBottom: 10,
  },
  linkCodeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.indigoBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  linkCodeText: {
    fontFamily: 'monospace',
    fontSize: 16,
    color: colors.indigo,
    fontWeight: '500',
  },
  linkUrl: {
    fontSize: 14,
    color: colors.mutedForeground,
    marginBottom: 12,
  },
  linkFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  linkMeta: {
    flexDirection: 'row',
    gap: 16,
  },
  linkClicks: {
    fontSize: 13,
    color: colors.green,
  },
  linkDate: {
    fontSize: 13,
    color: colors.mutedForeground,
  },
  categoryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '500',
  },
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    backgroundColor: 'rgba(23,23,23,0.95)',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: 25,
    paddingTop: 8,
    justifyContent: 'space-around',
    alignItems: 'flex-end',
  },
  tab: {
    alignItems: 'center',
    gap: 4,
    minWidth: 60,
  },
  tabLabel: {
    fontSize: 10,
    color: colors.mutedForeground,
  },
  tabLabelActive: {
    color: colors.indigo,
  },
  tabAddContainer: {
    marginTop: -20,
  },
  tabAddBtn: {
    width: 56,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    // Gradient effect approximation
    backgroundColor: '#6366f1',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
});
