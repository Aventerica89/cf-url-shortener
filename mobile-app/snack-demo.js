// LinkShort Mobile App - Expo Snack Demo
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

// Design tokens (Shadcn dark theme)
const colors = {
  background: '#0a0a0a',
  foreground: '#fafafa',
  card: '#171717',
  muted: '#262626',
  mutedForeground: '#a1a1aa',
  border: '#262626',
  indigo: '#818cf8',
  categories: {
    work: '#a855f7',
    personal: '#ec4899',
    social: '#06b6d4',
    marketing: '#f97316',
  },
};

// Mock data
const MOCK_LINKS = [
  {
    code: 'portfolio',
    destination: 'https://jbcloud.app/my-portfolio-page',
    clicks: 1247,
    category_name: 'Work',
    category_color: 'work',
    created_at: '2026-01-15T10:00:00Z',
    tags: ['website', 'main'],
  },
  {
    code: 'twitter',
    destination: 'https://twitter.com/yourhandle',
    clicks: 892,
    category_name: 'Social',
    category_color: 'social',
    created_at: '2026-01-20T14:30:00Z',
    tags: ['social'],
  },
  {
    code: 'newsletter',
    destination: 'https://newsletter.example.com/subscribe',
    clicks: 456,
    category_name: 'Marketing',
    category_color: 'marketing',
    created_at: '2026-01-22T09:15:00Z',
    tags: ['email', 'promo'],
    is_protected: true,
  },
  {
    code: 'blog',
    destination: 'https://blog.jbcloud.app/latest-post',
    clicks: 234,
    category_name: 'Personal',
    category_color: 'personal',
    created_at: '2026-01-25T16:45:00Z',
    tags: [],
  },
  {
    code: 'github',
    destination: 'https://github.com/yourusername',
    clicks: 178,
    category_name: 'Work',
    category_color: 'work',
    created_at: '2026-01-26T11:00:00Z',
    tags: ['code', 'dev'],
  },
];

// Stats Card Component
function StatsCard({ icon, value, label }) {
  const formatNumber = (num) => {
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  return (
    <View style={styles.statsCard}>
      <View style={styles.statsIcon}>
        <Feather name={icon} size={18} color={colors.indigo} />
      </View>
      <Text style={styles.statsValue}>{formatNumber(value)}</Text>
      <Text style={styles.statsLabel}>{label}</Text>
    </View>
  );
}

// Link Card Component
function LinkCard({ link, onPress, onCopy }) {
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const truncateUrl = (url, maxLength = 32) => {
    const clean = url.replace(/^https?:\/\//, '');
    return clean.length <= maxLength ? clean : clean.substring(0, maxLength) + '...';
  };

  const getCategoryColor = (colorName) => {
    return colors.categories[colorName] || colors.mutedForeground;
  };

  return (
    <TouchableOpacity style={styles.linkCard} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.linkContent}>
        {/* Short URL */}
        <View style={styles.linkRow}>
          <View style={styles.codeContainer}>
            {link.is_protected && (
              <Feather name="lock" size={12} color={colors.indigo} style={{ marginRight: 4 }} />
            )}
            <Text style={styles.linkCode}>/{link.code}</Text>
          </View>
          <TouchableOpacity onPress={onCopy} style={styles.copyBtn}>
            <Feather name="copy" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Destination */}
        <Text style={styles.linkDest} numberOfLines={1}>
          {truncateUrl(link.destination)}
        </Text>

        {/* Meta row */}
        <View style={styles.metaRow}>
          {link.category_name && (
            <View style={[styles.categoryBadge, { backgroundColor: getCategoryColor(link.category_color) + '20' }]}>
              <View style={[styles.categoryDot, { backgroundColor: getCategoryColor(link.category_color) }]} />
              <Text style={[styles.categoryText, { color: getCategoryColor(link.category_color) }]}>
                {link.category_name}
              </Text>
            </View>
          )}
          <View style={styles.clicksContainer}>
            <Feather name="mouse-pointer" size={12} color={colors.mutedForeground} />
            <Text style={styles.clicksText}>{link.clicks}</Text>
          </View>
          <Text style={styles.dateText}>{formatDate(link.created_at)}</Text>
        </View>

        {/* Tags */}
        {link.tags && link.tags.length > 0 && (
          <View style={styles.tagsRow}>
            {link.tags.slice(0, 3).map((tag, i) => (
              <View key={i} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

// Main App
export default function App() {
  const [links] = useState(MOCK_LINKS);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('links');

  const totalLinks = links.length;
  const totalClicks = links.reduce((sum, l) => sum + l.clicks, 0);

  const filteredLinks = links.filter(
    (l) =>
      l.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.destination.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCopy = (code) => {
    Alert.alert('Copied!', `links.jbcloud.app/${code} copied to clipboard`);
  };

  const handleLinkPress = (link) => {
    Alert.alert(link.code, `Destination: ${link.destination}\nClicks: ${link.clicks}`);
  };

  const renderHeader = () => (
    <View style={styles.header}>
      {/* Stats */}
      <View style={styles.statsRow}>
        <StatsCard icon="link" value={totalLinks} label="Total Links" />
        <StatsCard icon="mouse-pointer" value={totalClicks} label="Total Clicks" />
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
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

      {/* Section header */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Links</Text>
        <Text style={styles.sectionCount}>{filteredLinks.length} links</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* Title bar */}
      <View style={styles.titleBar}>
        <Text style={styles.title}>Links</Text>
        <TouchableOpacity style={styles.profileBtn}>
          <Feather name="user" size={20} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {/* Links list */}
      <FlatList
        data={filteredLinks}
        keyExtractor={(item) => item.code}
        renderItem={({ item }) => (
          <LinkCard
            link={item}
            onPress={() => handleLinkPress(item)}
            onCopy={() => handleCopy(item.code)}
          />
        )}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      />

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab('links')}
        >
          <Feather
            name="link"
            size={22}
            color={activeTab === 'links' ? colors.foreground : colors.mutedForeground}
          />
          <Text style={[styles.tabLabel, activeTab === 'links' && styles.tabLabelActive]}>
            Links
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab('analytics')}
        >
          <Feather
            name="bar-chart-2"
            size={22}
            color={activeTab === 'analytics' ? colors.foreground : colors.mutedForeground}
          />
          <Text style={[styles.tabLabel, activeTab === 'analytics' && styles.tabLabelActive]}>
            Analytics
          </Text>
        </TouchableOpacity>

        {/* Center add button */}
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => Alert.alert('Create Link', 'This would open the create link form')}
        >
          <View style={styles.addButtonInner}>
            <Feather name="plus" size={28} color="#fff" />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab('categories')}
        >
          <Feather
            name="folder"
            size={22}
            color={activeTab === 'categories' ? colors.foreground : colors.mutedForeground}
          />
          <Text style={[styles.tabLabel, activeTab === 'categories' && styles.tabLabelActive]}>
            Categories
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab('settings')}
        >
          <Feather
            name="settings"
            size={22}
            color={activeTab === 'settings' ? colors.foreground : colors.mutedForeground}
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
  titleBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.foreground,
  },
  profileBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.muted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statsCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    alignItems: 'center',
  },
  statsIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.indigo + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statsValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.foreground,
  },
  statsLabel: {
    fontSize: 13,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.muted,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 44,
    gap: 8,
    marginBottom: 20,
  },
  searchInput: {
    flex: 1,
    color: colors.foreground,
    fontSize: 15,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.foreground,
  },
  sectionCount: {
    fontSize: 13,
    color: colors.mutedForeground,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  linkContent: {
    flex: 1,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  codeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  linkCode: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.foreground,
  },
  copyBtn: {
    padding: 4,
  },
  linkDest: {
    fontSize: 13,
    color: colors.mutedForeground,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  categoryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '500',
  },
  clicksContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  clicksText: {
    fontSize: 13,
    color: colors.mutedForeground,
  },
  dateText: {
    fontSize: 13,
    color: colors.mutedForeground,
  },
  tagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  tag: {
    backgroundColor: colors.muted,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 11,
    color: colors.mutedForeground,
  },
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    backgroundColor: colors.card + 'F0',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: 20,
    paddingTop: 8,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tabItem: {
    alignItems: 'center',
    paddingVertical: 4,
    minWidth: 60,
  },
  tabLabel: {
    fontSize: 11,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  tabLabelActive: {
    color: colors.foreground,
  },
  addButton: {
    marginTop: -30,
  },
  addButtonInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.indigo,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.indigo,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
});
