import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';

class RecipeBoxView extends StatelessWidget {
  const RecipeBoxView({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.only(left: 16.0, right: 16.0, top: 16.0, bottom: 100.0),
      children: [
        _buildHeader(),
        const SizedBox(height: 16),
        _buildSearchBar(),
        const SizedBox(height: 16),
        _buildCategoryChips(),
        const SizedBox(height: 24),
        _buildHeroCard(),
        const SizedBox(height: 24),
        _buildSectionTitle(),
        const SizedBox(height: 16),
        _buildRecipeList(),
        const SizedBox(height: 24),
        _buildHearthTip(),
      ],
    );
  }

  Widget _buildHeader() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Text('Hearth Cookbook', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppTheme.secondaryContainer,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Text('24 saved', style: TextStyle(color: AppTheme.secondary, fontSize: 10, fontWeight: FontWeight.bold)),
                ),
              ],
            ),
            const SizedBox(height: 2),
            const Text('Shared co-op recipes, batch guides & family rituals', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
          ],
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: AppTheme.primary,
            borderRadius: BorderRadius.circular(8),
            boxShadow: [
              BoxShadow(color: AppTheme.primary.withValues(alpha: 0.2), blurRadius: 4, offset: const Offset(0, 2)),
            ],
          ),
          child: const Row(
            children: [
              Icon(Icons.add_circle, color: AppTheme.onPrimary, size: 16),
              SizedBox(width: 4),
              Text('Add Recipe', style: TextStyle(color: AppTheme.onPrimary, fontSize: 12, fontWeight: FontWeight.bold)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSearchBar() {
    return Row(
      children: [
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: AppTheme.surfaceContainerLow,
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Row(
              children: [
                Icon(Icons.search, color: AppTheme.textMuted, size: 18),
                SizedBox(width: 8),
                Expanded(
                  child: Text('Search recipes, ingredients (quinoa, paneer)...', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
                ),
                Icon(Icons.mic, color: AppTheme.textMuted, size: 18),
              ],
            ),
          ),
        ),
        const SizedBox(width: 8),
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: AppTheme.surfaceContainerLow,
            borderRadius: BorderRadius.circular(8),
          ),
          child: const Center(child: Icon(Icons.tune, color: AppTheme.textMuted, size: 20)),
        ),
      ],
    );
  }

  Widget _buildCategoryChips() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _buildChip('All (24)', isActive: true),
          _buildChip('⚡ Quick 20-min'),
          _buildChip('🍲 Comfort Stews'),
          _buildChip('🍂 Autumn Specials'),
          _buildChip('💪 High Protein'),
          _buildChip('☕ Hearth Breakfast'),
        ],
      ),
    );
  }

  Widget _buildChip(String label, {bool isActive = false}) {
    return Container(
      margin: const EdgeInsets.only(right: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      decoration: BoxDecoration(
        color: isActive ? AppTheme.primary : AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(16),
        boxShadow: isActive ? [BoxShadow(color: AppTheme.primary.withValues(alpha: 0.2), blurRadius: 4, offset: const Offset(0, 2))] : null,
      ),
      child: Text(
        label,
        style: TextStyle(
          color: isActive ? AppTheme.onPrimary : AppTheme.textMuted,
          fontSize: 12,
          fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
        ),
      ),
    );
  }

  Widget _buildHeroCard() {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.4), blurRadius: 16, offset: const Offset(0, 4)),
        ],
      ),
      child: Column(
        children: [
          Stack(
            children: [
              Container(
                height: 180,
                width: double.infinity,
                decoration: const BoxDecoration(
                  borderRadius: BorderRadius.only(topLeft: Radius.circular(12), topRight: Radius.circular(12)),
                  image: DecorationImage(
                    image: NetworkImage('https://lh3.googleusercontent.com/aida-public/AB6AXuBoMlgQasavCAEHdcr91R8sWXiSWaCMnPdXttAx5ynUGsh5_veag10O9iDQyrSaA1ZAKLimS50ky8VfMFORy6DaXAKm2AsSFihnBfssBcA6hychL7jhCabICATzuqM6NOrZEd1LYZRF5gVeFjDbgP47MENfQCGPpjZ0SSoe98akLL-WnDe-DzsX8dyrcGyIRXPg6vpr6eMoXDO68Sc1kqrGLciBsJGQIapLsfiqb17eGhoeWI94so4RVg'),
                    fit: BoxFit.cover,
                  ),
                ),
              ),
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: const BorderRadius.only(topLeft: Radius.circular(12), topRight: Radius.circular(12)),
                    gradient: LinearGradient(
                      begin: Alignment.bottomCenter,
                      end: Alignment.topCenter,
                      colors: [AppTheme.surfaceContainer.withValues(alpha: 1.0), AppTheme.surfaceContainer.withValues(alpha: 0.4), Colors.transparent],
                    ),
                  ),
                ),
              ),
              Positioned(
                top: 12,
                left: 12,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppTheme.background.withValues(alpha: 0.8),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.fireplace, color: AppTheme.primary, size: 14),
                      SizedBox(width: 4),
                      Text("TONIGHT'S HEARTH PICK", style: TextStyle(color: AppTheme.primary, fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 1)),
                    ],
                  ),
                ),
              ),
              Positioned(
                top: 12,
                right: 12,
                child: Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: AppTheme.background.withValues(alpha: 0.7),
                    shape: BoxShape.circle,
                  ),
                  child: const Center(child: Icon(Icons.favorite, color: AppTheme.tertiary, size: 18)),
                ),
              ),
              Positioned(
                bottom: 12,
                left: 12,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceContainerHigh.withValues(alpha: 0.9),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 16,
                        height: 16,
                        decoration: const BoxDecoration(
                          shape: BoxShape.circle,
                          image: DecorationImage(image: NetworkImage('https://lh3.googleusercontent.com/aida/AEtjO1XyojsfHe3lSwRDkTnVOl8vNPMED8kKbtG7ptdFcjkRLthpwLJRPJVnhg6sMlFTy0x3UXQEEANxVxgY_wWZcsif7XryPZlRIk-I5h7fXaqiFL95vD9kVzHO3kmsXI3pRw0xX6mWcRuL3TGq6cxz_7BWyC_F7xW82D2FE75ZOjc_sXwdF3bsgeibWz-6Rsv8-x33WmrxRPEG-yVvBWCN_FRs70jHQH5_zAHfjvv20cHDxzrimF-pjx24d3n8'), fit: BoxFit.cover),
                        ),
                      ),
                      const SizedBox(width: 6),
                      const Text('Curated by Alex & Rosie', style: TextStyle(color: AppTheme.textPrimary, fontSize: 10)),
                    ],
                  ),
                ),
              )
            ],
          ),
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Quinoa & Roasted Autumn Veggies', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                          SizedBox(height: 4),
                          Row(
                            children: [
                              Icon(Icons.schedule, color: AppTheme.textMuted, size: 14),
                              SizedBox(width: 4),
                              Text('25m', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
                              SizedBox(width: 8),
                              Text('•', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
                              SizedBox(width: 8),
                              Icon(Icons.group, color: AppTheme.textMuted, size: 14),
                              SizedBox(width: 4),
                              Text('4 Servings', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
                              SizedBox(width: 8),
                              Text('•', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
                              SizedBox(width: 8),
                              Text('₹210 total', style: TextStyle(color: AppTheme.secondary, fontSize: 12, fontWeight: FontWeight.bold)),
                            ],
                          ),
                        ],
                      ),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text('480 kcal', style: TextStyle(color: AppTheme.primary, fontSize: 12, fontWeight: FontWeight.bold)),
                        Text('per portion', style: TextStyle(color: AppTheme.textMuted, fontSize: 10)),
                      ],
                    )
                  ],
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceContainerLow,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        children: [
                          Icon(Icons.inventory_2, color: AppTheme.secondary, size: 16),
                          SizedBox(width: 6),
                          Text('Pantry check: ', style: TextStyle(color: AppTheme.textPrimary, fontSize: 12)),
                          Text('6 of 7', style: TextStyle(color: AppTheme.secondary, fontSize: 12, fontWeight: FontWeight.bold)),
                          Text(' ingredients ready', style: TextStyle(color: AppTheme.textPrimary, fontSize: 12)),
                        ],
                      ),
                      Text('Need: Squash', style: TextStyle(color: AppTheme.textMuted, fontSize: 10)),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    _buildTag('Vegetarian'),
                    _buildTag('Batch Friendly'),
                    _buildTag('Autumn Hearth'),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        decoration: BoxDecoration(
                          color: AppTheme.primary,
                          borderRadius: BorderRadius.circular(8),
                          boxShadow: [BoxShadow(color: AppTheme.primary.withValues(alpha: 0.2), blurRadius: 4, offset: const Offset(0, 2))],
                        ),
                        child: const Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.soup_kitchen_rounded, color: AppTheme.onPrimary, size: 16),
                            SizedBox(width: 6),
                            Text('Cook Tonight', style: TextStyle(color: AppTheme.onPrimary, fontSize: 12, fontWeight: FontWeight.bold)),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        decoration: BoxDecoration(
                          color: AppTheme.surfaceContainerHigh,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.add_shopping_cart, color: AppTheme.textPrimary, size: 16),
                            SizedBox(width: 6),
                            Text('Add to Grocery', style: TextStyle(color: AppTheme.textPrimary, fontSize: 12, fontWeight: FontWeight.bold)),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildTag(String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(label, style: const TextStyle(color: AppTheme.textMuted, fontSize: 10)),
    );
  }

  Widget _buildSectionTitle() {
    return const Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Hearth Rotation & Co-op Staples', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            Text('Household verified favorites & seasonal staples', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
          ],
        ),
        Row(
          children: [
            Text('View all', style: TextStyle(color: AppTheme.primary, fontSize: 12, fontWeight: FontWeight.bold)),
            SizedBox(width: 2),
            Icon(Icons.chevron_right, color: AppTheme.primary, size: 14),
          ],
        ),
      ],
    );
  }

  Widget _buildRecipeList() {
    return Column(
      children: [
        _buildRecipeListItem(
          image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAuh_O14-DzEJkkW3yOU7allMy8ZkYDPC4F13FpwarLGyua0aysa9hOFm2XOXA8-OA9L0wuNVepQjGAbHB8zxCzftc8HzO9WJWuHsNg7WBmq6MuFYj0jaE8JYr4IZZ8CcZq7qvlcDeYVvC-Rsdul41ipwrGY-isJsRITbM6vpM1lCAYwAZssJTr5DCcNBMlrJ4zVTIAIZNMyX9hpIk-CF6k4wqRyhJZs9HWg9UK3lv8MxvXV-djQCuTfg',
          title: 'Paneer Gravy & Fragrant Jeera Rice',
          desc: 'Favorite of Maya • Mild Spice warmth',
          time: '50m',
          servings: '5 Servings',
          price: '₹260 (5/5 in stock)',
          badgeLabel: 'Pantry Ready',
          badgeColor: AppTheme.secondary,
          badgeBg: AppTheme.secondaryContainer,
          actionIcon: Icons.calendar_today,
          actionLabel: 'Plan for Wed',
          statusIcon: Icons.check_circle,
          statusLabel: 'All ingredients in pantry',
          statusColor: AppTheme.secondary,
          isFavorite: true,
        ),
        const SizedBox(height: 12),
        _buildRecipeListItem(
          image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCuf1R3g4dOtOHb3dusc6iDZHVGTFhgF4lOOmF81YCLkrM62w9b8-Iy5hB7Nbac7XWvHs--4fWC-BEdYve4lc1Mbl9hbU2ZX_PXjc2uwOfkfDGa-ob5hEwXRXdynZePAq9bpRRq0YFqCaWA6Ixvh-yPkEmZhO6_P3eiZSa_tiAUSUvSVPksxghW0TK1CvftSQbbZozOLh3P72skiFK0UM7B47qi01RHctNP756g5T2tf3h4DD5DXae3iw',
          title: 'Charred Pepper & Black Bean Fajitas',
          desc: 'Quick Prep • High Satiety',
          time: '35m',
          servings: '4 Servings',
          price: '₹190 (4/6 stock)',
          priceColor: AppTheme.textMuted,
          badgeLabel: 'High Fiber',
          badgeColor: AppTheme.textMuted,
          badgeBg: AppTheme.surfaceContainerHighest,
          actionIcon: Icons.add_shopping_cart,
          actionLabel: 'Missing items',
          statusIcon: null,
          statusLabel: 'Missing: Fresh Jalapeño, Tortillas',
          statusColor: AppTheme.textMuted,
          isFavorite: false,
        ),
        const SizedBox(height: 12),
        _buildRecipeListItem(
          image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCe70U7HzdV-wLpq9MOCWFyH1z_5OqvS9uQAz8P4-f7PTf5GituswVjDJcBmMP0vb-E1Dbd-7Gl0bbrvVxyemaXpRDhD6K9guO2mrnR9qIURUfi7Vi9vm76wJdBAM1OtLLli1xkylj9THg2uEXcAEQS0L9VwLR51ry2pPOpAHtjs4b0IY7AkgLeVxN56ylXAnDCF5XF1MXzBW3xseBeayLJFG2ge_5gi5i6eadoRFpfDOHBLYIjhuZCnQ',
          title: 'Hummus & Herb Roasted Veggie Wrap',
          desc: 'Ideal lunch batch • 15 min ready',
          time: '15m',
          servings: '2 Servings',
          price: '₹120 (All ready)',
          badgeLabel: 'No-Cook Assembly',
          badgeColor: AppTheme.textMuted,
          badgeBg: AppTheme.surfaceContainerHighest,
          actionIcon: Icons.restaurant,
          actionLabel: 'Quick Prep',
          statusIcon: Icons.check_circle,
          statusLabel: 'Batch ready in fridge',
          statusColor: AppTheme.secondary,
          isFavorite: false,
        ),
      ],
    );
  }

  Widget _buildRecipeListItem({
    required String image,
    required String title,
    required String desc,
    required String time,
    required String servings,
    required String price,
    Color priceColor = AppTheme.primary,
    required String badgeLabel,
    required Color badgeColor,
    required Color badgeBg,
    required IconData actionIcon,
    required String actionLabel,
    IconData? statusIcon,
    required String statusLabel,
    required Color statusColor,
    required bool isFavorite,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.2), blurRadius: 8, offset: const Offset(0, 2))],
      ),
      child: Column(
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 96,
                height: 96,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(8),
                  image: DecorationImage(image: NetworkImage(image), fit: BoxFit.cover),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: badgeBg,
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(badgeLabel, style: TextStyle(color: badgeColor, fontSize: 10)),
                        ),
                        Icon(Icons.favorite, color: isFavorite ? AppTheme.tertiary : AppTheme.textMuted, size: 18),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold), maxLines: 1, overflow: TextOverflow.ellipsis),
                    Text(desc, style: const TextStyle(color: AppTheme.textMuted, fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.timer, color: AppTheme.textMuted, size: 14),
                            const SizedBox(width: 4),
                            Text(time, style: const TextStyle(color: AppTheme.textMuted, fontSize: 10)),
                          ],
                        ),
                        Text(servings, style: const TextStyle(color: AppTheme.textMuted, fontSize: 10)),
                        Text(price, style: TextStyle(color: priceColor, fontSize: 10, fontWeight: FontWeight.bold)),
                      ],
                    )
                  ],
                ),
              )
            ],
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  if (statusIcon != null) ...[
                    Icon(statusIcon, color: statusColor, size: 16),
                    const SizedBox(width: 4),
                  ],
                  Text(statusLabel, style: TextStyle(color: statusColor, fontSize: 10)),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceContainerHigh,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Row(
                  children: [
                    Icon(actionIcon, color: AppTheme.textPrimary, size: 14),
                    const SizedBox(width: 4),
                    Text(actionLabel, style: const TextStyle(color: AppTheme.textPrimary, fontSize: 12, fontWeight: FontWeight.bold)),
                  ],
                ),
              )
            ],
          )
        ],
      ),
    );
  }

  Widget _buildHearthTip() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.background,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppTheme.primary.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Center(child: Icon(Icons.tips_and_updates, color: AppTheme.primary)),
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text("Alex & Maya's Hearth Tip", style: TextStyle(color: AppTheme.primary, fontSize: 12, fontWeight: FontWeight.bold)),
                SizedBox(height: 2),
                Text('"Double the Quinoa & Veggies batch tonight — the remainder rolls directly into tomorrow\'s lunchtime wraps, saving ₹180 and 30 minutes!"', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
              ],
            ),
          )
        ],
      ),
    );
  }
}

class SmartGroceryView extends StatelessWidget {
  const SmartGroceryView({super.key});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        ListView(
          padding: const EdgeInsets.only(left: 16.0, right: 16.0, top: 16.0, bottom: 100.0),
          children: [
            _buildCartOverview(),
            const SizedBox(height: 16),
            _buildQuickAddBar(),
            const SizedBox(height: 24),
            _buildAisleSection(
              icon: Icons.local_florist,
              title: 'Vegetables & Fresh Produce',
              count: '4 items',
              color: AppTheme.secondary,
              items: [
                _GroceryItem('Broccoli Florets', '2 heads', 'For Quinoa Veggies', badgeLabel: 'Produce', imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAOLQQMD55PtIlAANIrXUXQGGeR71nop-D-e2KtzoYDaVUaR7Ce2YPeB8479dXwK0Z06ZUerZskJH0fgBSKi8cw440d1oslmRf64lRXQDi2N3yHj0qFrtwLZGc1OtFflsZ38krmQrfEZJ4QMMqNiM0dzKwRBs2Y7SsgmXhYYXqWt-4N_Qp5UdalalcX2OzrFR1BETBbLKKFXILQ9WJ7H2aRmjn9xe10mDLif_7CBNbuMwxW57KFuR1mpw'),
                _GroceryItem('Bell Peppers (Mixed)', '3 pcs', 'For Sheetpan Fajitas', badgeLabel: 'Crisp Aisle'),
                _GroceryItem('Fresh Cilantro & Limes', '1 bunch + 2x', 'Pantry Garnish', badgeLabel: 'Herbs'),
                _GroceryItem('Baby Spinach', '1 tub (300g)', 'Salad & Smoothies', badgeLabel: 'Salad Bay', badgeColor: AppTheme.primary),
              ],
            ),
            const SizedBox(height: 24),
            _buildAisleSection(
              icon: Icons.water_drop,
              title: 'Dairy & Plant Alternatives',
              count: '3 items',
              color: AppTheme.secondary,
              items: [
                _GroceryItem('Oat Milk Barista Blend', '2 Liters', 'Morning Coffee Station', imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBStESHkAtxqX0ImK1ZNsJUd7W6CteoKm82P_QIt9BAOTbhgOSY3SRDARmt3XXxDQcd3Q1I10OD2suB2aKkEGC1f1PdbjiZO4IVto1grjVWySQYuq2sOP3FIlUhDNxmZCzerVIRqU-glJ_hb3puFpxivGVkp89mIEoR5z3ck33czFMqU8W75IehkxtmBfmoUAW_9xuPS8cKvNYW5M9rLMnjOD7s-mcIu3IYZIgCxhLvTyKWEEIQFLTUGg'),
                _GroceryItem('Paneer Artisanal Block', '400g', 'For Hearth Curry Night', badgeLabel: 'Chilled'),
                _GroceryItem('Greek Yogurt (Whole Milk)', '1 tub (1kg)', 'Breakfast Parfaits', badgeLabel: 'Dairy Row'),
              ],
            ),
            const SizedBox(height: 24),
            _buildAisleSection(
              icon: Icons.grain,
              title: 'Pantry, Grains & Spices',
              count: '3 items',
              color: AppTheme.primary,
              items: [
                _GroceryItem('Tri-Color Quinoa', '500g pouch', 'Batch Bowl Cooking', badgeLabel: 'Aisle 4'),
                _GroceryItem('Corn & Flour Tortillas', '1 pack (10x)', 'Taco Tuesday Hearth', badgeLabel: 'Bakery'),
                _GroceryItem('Cumin & Garam Masala Jars', '2 refill jars', 'Spice Rack Refill', imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAO3x-XgWptnjEqt7Oj1q4Rr-Zs9JJyA0wtvs99hmkl9-BVCK6vGY9JSyGPK0yxk9x4rOFQhMDGYWG9TD5bKMxxb7qt-n-p32aMNV0hfu-U-R0MgtbM-lELRPKFVBktB8eBuBuD3mizkURy_ygohkp9BaztaNVh2eOU-IqKw33q4msDvqbzx1VAmiRbAh7Jq0Db73to_e38OvtC8T9pvbNafEUFMivNbrtSOfLJ6ZNBLdMftykzB0YXwA'),
              ],
            ),
            const SizedBox(height: 24),
            _buildCheckedItems(),
            const SizedBox(height: 48), // Space for floating button
          ],
        ),
        Positioned(
          bottom: 16,
          left: 16,
          right: 16,
          child: _buildFloatingShopButton(),
        ),
      ],
    );
  }

  Widget _buildCartOverview() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.1), blurRadius: 4, offset: const Offset(0, 2))],
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(width: 10, height: 10, decoration: const BoxDecoration(color: AppTheme.primaryContainer, shape: BoxShape.circle)),
                        const SizedBox(width: 8),
                        const Text('WEEKLY HEARTH SYNC', style: TextStyle(color: AppTheme.primary, fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 1)),
                      ],
                    ),
                    const SizedBox(height: 4),
                    const Text('Pantry & Market Cart', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 2),
                    const Text('Linked to 4 upcoming dinners & breakfasts', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceContainerHigh,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.borderLight),
                ),
                child: const Column(
                  children: [
                    Text('16', style: TextStyle(color: AppTheme.primary, fontSize: 20, fontWeight: FontWeight.bold)),
                    Text('items left', style: TextStyle(color: AppTheme.textMuted, fontSize: 10)),
                  ],
                ),
              )
            ],
          ),
          const SizedBox(height: 16),
          const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Icon(Icons.check_circle, color: AppTheme.secondary, size: 14),
                  SizedBox(width: 4),
                  Text('8', style: TextStyle(color: AppTheme.textPrimary, fontSize: 12, fontWeight: FontWeight.bold)),
                  SizedBox(width: 4),
                  Text('completed', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
                ],
              ),
              Text('66% remaining', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
            ],
          ),
          const SizedBox(height: 8),
          Container(
            height: 8,
            width: double.infinity,
            decoration: BoxDecoration(
              color: AppTheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(4),
            ),
            child: Row(
              children: [
                Expanded(flex: 33, child: Container(decoration: const BoxDecoration(color: AppTheme.secondary, borderRadius: BorderRadius.only(topLeft: Radius.circular(4), bottomLeft: Radius.circular(4))))),
                Expanded(flex: 67, child: Container(decoration: const BoxDecoration(color: AppTheme.primaryContainer, borderRadius: BorderRadius.only(topRight: Radius.circular(4), bottomRight: Radius.circular(4))))),
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildQuickAddBar() {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: AppTheme.surfaceContainer,
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Center(child: Icon(Icons.mic, color: AppTheme.textMuted, size: 20)),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              decoration: InputDecoration(
                hintText: 'Add grocery or pantry item...',
                hintStyle: TextStyle(color: AppTheme.textMuted.withValues(alpha: 0.5), fontSize: 14),
                border: InputBorder.none,
              ),
              style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14),
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: AppTheme.surfaceContainer,
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Row(
              children: [
                Icon(Icons.eco, color: AppTheme.primary, size: 14),
                SizedBox(width: 4),
                Text('Produce', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: AppTheme.primaryContainer,
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Center(child: Icon(Icons.add, color: AppTheme.onPrimaryContainer, size: 20)),
          ),
        ],
      ),
    );
  }

  Widget _buildAisleSection({required IconData icon, required String title, required String count, required Color color, required List<_GroceryItem> items}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                Container(
                  width: 24,
                  height: 24,
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.2),
                    border: Border.all(color: color.withValues(alpha: 0.3)),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Center(child: Icon(icon, color: color, size: 14)),
                ),
                const SizedBox(width: 8),
                Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              ],
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: AppTheme.surfaceContainer,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(count, style: const TextStyle(color: AppTheme.textMuted, fontSize: 10)),
            ),
          ],
        ),
        const SizedBox(height: 8),
        ...items.map((item) => Padding(
              padding: const EdgeInsets.only(bottom: 8.0),
              child: _buildGroceryItemCard(item),
            )),
      ],
    );
  }

  Widget _buildGroceryItemCard(_GroceryItem item) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Row(
              children: [
                const Icon(Icons.drag_indicator, color: AppTheme.textMuted, size: 18),
                const SizedBox(width: 12),
                Container(
                  width: 20,
                  height: 20,
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceContainerHighest,
                    border: Border.all(color: AppTheme.borderLight),
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(item.title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppTheme.secondaryContainer.withValues(alpha: 0.4),
                              border: Border.all(color: AppTheme.secondary.withValues(alpha: 0.2)),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(item.qty, style: const TextStyle(color: AppTheme.secondary, fontSize: 10)),
                          ),
                          const SizedBox(width: 8),
                          Expanded(child: Text(item.desc, style: const TextStyle(color: AppTheme.textMuted, fontSize: 10), maxLines: 1, overflow: TextOverflow.ellipsis)),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          if (item.imageUrl != null)
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppTheme.borderLight),
                image: DecorationImage(image: NetworkImage(item.imageUrl!), fit: BoxFit.cover),
              ),
            )
          else if (item.badgeLabel != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: AppTheme.surfaceContainerHigh,
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: AppTheme.borderLight),
              ),
              child: Text(item.badgeLabel!, style: TextStyle(color: item.badgeColor ?? AppTheme.secondary, fontSize: 10)),
            )
          else
            const Icon(Icons.eco, color: AppTheme.textMuted, size: 18),
        ],
      ),
    );
  }

  Widget _buildCheckedItems() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.keyboard_arrow_down, color: AppTheme.primary, size: 18),
                  SizedBox(width: 8),
                  Text('Checked Items (8)', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: AppTheme.secondaryContainer.withValues(alpha: 0.4),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.secondary.withValues(alpha: 0.2)),
                ),
                child: const Text('In Pantry', style: TextStyle(color: AppTheme.secondary, fontSize: 10)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _buildCheckedItem('Bhindi / Okra (Fresh Crisp)', '500g'),
          const SizedBox(height: 8),
          _buildCheckedItem('Sourdough Loaf (Hearth Baked)', '1 loaf'),
          const SizedBox(height: 8),
          _buildCheckedItem('Olive Oil (Cold Pressed)', '750ml'),
        ],
      ),
    );
  }

  Widget _buildCheckedItem(String title, String qty) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainer.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Container(
                width: 20,
                height: 20,
                decoration: BoxDecoration(
                  color: AppTheme.secondaryContainer,
                  border: Border.all(color: AppTheme.secondary.withValues(alpha: 0.3)),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Center(child: Icon(Icons.check, color: AppTheme.secondary, size: 12)),
              ),
              const SizedBox(width: 12),
              Text(title, style: const TextStyle(color: AppTheme.textMuted, fontSize: 14, decoration: TextDecoration.lineThrough)),
            ],
          ),
          Text(qty, style: const TextStyle(color: AppTheme.textMuted, fontSize: 10)),
        ],
      ),
    );
  }

  Widget _buildFloatingShopButton() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainerHigh.withValues(alpha: 0.95),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.borderLight),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.3), blurRadius: 16, offset: const Offset(0, 4))],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: AppTheme.secondaryContainer,
                  border: Border.all(color: AppTheme.secondary.withValues(alpha: 0.3)),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Center(child: Icon(Icons.storefront, color: AppTheme.secondary, size: 16)),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('Target / Organic Grove', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Container(width: 6, height: 6, decoration: const BoxDecoration(color: AppTheme.secondary, shape: BoxShape.circle)),
                      const SizedBox(width: 4),
                      const Text('Aisle route sorted', style: TextStyle(color: AppTheme.secondary, fontSize: 10)),
                    ],
                  ),
                ],
              ),
            ],
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: AppTheme.primaryContainer,
              borderRadius: BorderRadius.circular(12),
              boxShadow: [BoxShadow(color: AppTheme.primaryContainer.withValues(alpha: 0.4), blurRadius: 4, offset: const Offset(0, 2))],
            ),
            child: const Row(
              children: [
                Icon(Icons.shopping_cart_checkout, color: AppTheme.onPrimaryContainer, size: 16),
                SizedBox(width: 6),
                Text('Start In-Store Shop', style: TextStyle(color: AppTheme.onPrimaryContainer, fontSize: 12, fontWeight: FontWeight.bold)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _GroceryItem {
  final String title;
  final String qty;
  final String desc;
  final String? badgeLabel;
  final String? imageUrl;
  final Color? badgeColor;

  _GroceryItem(this.title, this.qty, this.desc, {this.badgeLabel, this.imageUrl, this.badgeColor});
}
