import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AppTheme {
  // Nordic Hearth Color Palette (Material Design 3 aligned)
  static const Color primary = Color(0xFFEAA52C); // Golden Ochre
  static const Color primaryContainer = Color(0xFFE08B26); // Warm Amber
  static const Color onPrimary = Color(0xFF120E0E); // Deep Espresso
  static const Color onPrimaryContainer = Color(0xFF120E0E); // Deep Espresso

  static const Color secondary = Color(0xFF7B9DA5); // Nordic Slate Teal
  static const Color secondaryContainer = Color(0xFF5A7B83); // Deep Teal
  static const Color onSecondary = Color(0xFFF3EDE6); // Warm Cream
  static const Color onSecondaryContainer = Color(0xFFF3EDE6);

  static const Color tertiary = Color(0xFF8A3D3C); // Steeped Fig
  static const Color tertiaryContainer = Color(0xFF3D1C24); // Deep Plum
  static const Color onTertiary = Color(0xFFF3EDE6);
  static const Color onTertiaryContainer = Color(0xFFF3EDE6);

  static const Color error = Color(0xFFCF6679);
  static const Color onError = Color(0xFF1E0F11);

  // Background and Surfaces (Material 3 Surface Elevation)
  static const Color background = Color(0xFF120E0E); // Deepest Espresso
  static const Color surfaceContainerLowest = Color(0xFF0F0B0B);
  static const Color surfaceContainerLow = Color(0xFF1A1415); // Resting cards
  static const Color surfaceContainer = Color(0xFF241C1E); // Elevated cards
  static const Color surfaceContainerHigh = Color(0xFF2F2427); // Floating elements
  static const Color surfaceContainerHighest = Color(0xFF3B2E32);

  // Text Colors
  static const Color textPrimary = Color(0xFFF3EDE6); // Warm Steamed Cream
  static const Color textSecondary = Color(0xFFDFD7CC); // Toasted Almond
  static const Color textMuted = Color(0xFF9E9188); // Hearth Ash

  // Borders & Outlines
  static const Color borderLight = Color(0x14F3EDE6); // rgba(243, 237, 230, 0.08)
  static const Color borderTeal = Color(0x2E7B9DA5); // rgba(123, 157, 165, 0.18)

  static ThemeData get darkTheme {
    final baseTextTheme = GoogleFonts.hankenGroteskTextTheme(
      ThemeData.dark().textTheme,
    ).apply(
      bodyColor: textPrimary,
      displayColor: textPrimary,
    );

    const colorScheme = ColorScheme(
      brightness: Brightness.dark,
      primary: primary,
      onPrimary: onPrimary,
      primaryContainer: primaryContainer,
      onPrimaryContainer: onPrimaryContainer,
      secondary: secondary,
      onSecondary: onSecondary,
      secondaryContainer: secondaryContainer,
      onSecondaryContainer: onSecondaryContainer,
      tertiary: tertiary,
      onTertiary: onTertiary,
      tertiaryContainer: tertiaryContainer,
      onTertiaryContainer: onTertiaryContainer,
      error: error,
      onError: onError,
      surface: surfaceContainer,
      onSurface: textPrimary,
      surfaceContainerLowest: surfaceContainerLowest,
      surfaceContainerLow: surfaceContainerLow,
      surfaceContainer: surfaceContainer,
      surfaceContainerHigh: surfaceContainerHigh,
      surfaceContainerHighest: surfaceContainerHighest,
      outline: borderLight,
      outlineVariant: borderTeal,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: background,
      textTheme: baseTextTheme.copyWith(
        displayLarge: baseTextTheme.displayLarge?.copyWith(fontWeight: FontWeight.w700),
        displayMedium: baseTextTheme.displayMedium?.copyWith(fontWeight: FontWeight.w700),
        displaySmall: baseTextTheme.displaySmall?.copyWith(fontWeight: FontWeight.w600),
        headlineMedium: baseTextTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w600),
        titleLarge: baseTextTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600),
        bodyLarge: baseTextTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w400, height: 1.5),
        bodyMedium: baseTextTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w400, height: 1.5),
        labelLarge: baseTextTheme.labelLarge?.copyWith(fontWeight: FontWeight.w600, letterSpacing: 0.2),
        labelSmall: baseTextTheme.labelSmall?.copyWith(fontWeight: FontWeight.w600, letterSpacing: 0.2),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: background,
        elevation: 0,
        scrolledUnderElevation: 1,
        centerTitle: false,
        titleTextStyle: baseTextTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600, color: textPrimary),
        iconTheme: const IconThemeData(color: textPrimary),
      ),
      cardTheme: CardThemeData(
        color: surfaceContainer,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: borderLight),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: onPrimary,
          textStyle: const TextStyle(fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: onPrimary,
          textStyle: const TextStyle(fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: textPrimary,
          side: const BorderSide(color: borderLight),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: secondary,
          textStyle: const TextStyle(fontWeight: FontWeight.w600),
        ),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: primary,
        foregroundColor: onPrimary,
        elevation: 3,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: surfaceContainerHigh,
        selectedColor: primary.withAlpha(50),
        disabledColor: surfaceContainerLow,
        labelStyle: const TextStyle(color: textPrimary, fontSize: 13, fontWeight: FontWeight.w500),
        secondaryLabelStyle: const TextStyle(color: primary, fontSize: 13, fontWeight: FontWeight.w600),
        side: const BorderSide(color: borderLight),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      ),
      inputDecorationTheme: InputDecorationTheme(
        fillColor: surfaceContainerLow,
        filled: true,
        hintStyle: const TextStyle(color: textMuted),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: borderLight),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: borderLight),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: primary, width: 1.5),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: borderLight,
        space: 1,
        thickness: 1,
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return primary;
          }
          return surfaceContainerLow;
        }),
        checkColor: WidgetStateProperty.all(onPrimary),
        side: const BorderSide(color: borderTeal),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(4),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: surfaceContainerLow,
        indicatorColor: primary.withAlpha(60),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const IconThemeData(color: primary, size: 24);
          }
          return const IconThemeData(color: textMuted, size: 24);
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const TextStyle(color: primary, fontWeight: FontWeight.w600, fontSize: 12);
          }
          return const TextStyle(color: textMuted, fontWeight: FontWeight.w500, fontSize: 12);
        }),
        elevation: 3,
        height: 68,
      ),
    );
  }
}
