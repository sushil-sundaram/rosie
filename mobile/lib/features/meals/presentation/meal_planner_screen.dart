import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';
import '../../recipes/presentation/recipe_box_screen.dart';

class MealPlannerScreen extends StatefulWidget {
  const MealPlannerScreen({super.key});

  @override
  State<MealPlannerScreen> createState() => _MealPlannerScreenState();
}

class _MealPlannerScreenState extends State<MealPlannerScreen> {
  int _selectedTabIndex = 0; // 0: Weekly Plan, 1: Recipe Box, 2: Smart Grocery

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Rosie', style: Theme.of(context).textTheme.titleLarge?.copyWith(color: AppTheme.textPrimary)),
            Text('Meals', style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppTheme.textMuted)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () {},
          ),
          const Padding(
            padding: EdgeInsets.only(right: 16.0),
            child: CircleAvatar(
              radius: 16,
              backgroundColor: AppTheme.surfaceContainerHigh,
              child: Text('ST', style: TextStyle(fontSize: 12, color: AppTheme.textPrimary)),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // Sub Nav Tabs
          Padding(
            padding: const EdgeInsets.only(left: 16.0, right: 16.0, top: 16.0),
            child: _buildSubNavPills(),
          ),
          Expanded(
            child: _buildSelectedView(),
          ),
        ],
      ),
    );
  }

  Widget _buildSelectedView() {
    switch (_selectedTabIndex) {
      case 1:
        return const RecipeBoxView();
      case 2:
        return const SmartGroceryView();
      case 0:
      default:
        return Stack(
          children: [
            ListView(
              padding: const EdgeInsets.only(left: 16.0, right: 16.0, top: 16.0, bottom: 100.0),
              children: [
                _buildKitchenBanner(),
                const SizedBox(height: 16),
                _buildCalendarStrip(),
                const SizedBox(height: 24),
                _buildAgendaFriday(),
                const SizedBox(height: 24),
                _buildAgendaSaturday(),
                const SizedBox(height: 24),
                _buildAgendaSunday(),
                const SizedBox(height: 24),
                _buildPastItemsDrawer(),
              ],
            ),
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: _buildStickyActionBar(),
            ),
          ],
        );
    }
  }

  Widget _buildKitchenBanner() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(width: 8, height: 8, decoration: const BoxDecoration(color: AppTheme.primary, shape: BoxShape.circle)),
                      const SizedBox(width: 8),
                      const Text('WEEK 42 • AUTUMN HEARTH', style: TextStyle(color: AppTheme.primary, fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 1)),
                    ],
                  ),
                  const SizedBox(height: 4),
                  const Text('Mindful Nourishment', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24)),
                  const SizedBox(height: 2),
                  const Text('5 dinners booked • 2 prep duties open', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
                ],
              ),
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppTheme.primary,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Center(child: Icon(Icons.add, color: AppTheme.onPrimary)),
              )
            ],
          ),
          const SizedBox(height: 16),
          const Divider(height: 1),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _buildMicroMetric('Pantry Ready', '82%', AppTheme.secondary),
              _buildMicroMetric('Servings', '18 Plates', AppTheme.textPrimary),
              _buildMicroMetric('Cook Rotation', 'You & Mia', AppTheme.primary),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildMicroMetric(String label, String value, Color valueColor) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppTheme.textMuted, fontSize: 10)),
        const SizedBox(height: 2),
        Text(value, style: TextStyle(color: valueColor, fontWeight: FontWeight.bold, fontSize: 14)),
      ],
    );
  }

  Widget _buildSubNavPills() {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppTheme.background,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Row(
        children: [
          Expanded(child: _buildNavTab(0, Icons.calendar_today, 'Weekly Plan')),
          Expanded(child: _buildNavTab(1, Icons.menu_book, 'Recipe Box')),
          Expanded(child: _buildNavTab(2, Icons.shopping_basket, 'Smart Grocery')),
        ],
      ),
    );
  }

  Widget _buildNavTab(int index, IconData icon, String label) {
    final isActive = _selectedTabIndex == index;
    return GestureDetector(
      onTap: () {
        setState(() {
          _selectedTabIndex = index;
        });
      },
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: isActive ? AppTheme.surfaceContainerHigh : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
          border: isActive ? Border.all(color: AppTheme.borderLight) : null,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 16, color: isActive ? AppTheme.primary : AppTheme.textMuted),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                color: isActive ? AppTheme.textPrimary : AppTheme.textMuted,
                fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
                fontSize: 12,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCalendarStrip() {
    return Column(
      children: [
        const Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('October 16 – 22', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
            Text('3 days remaining', style: TextStyle(color: AppTheme.secondary, fontSize: 10, fontWeight: FontWeight.bold)),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            _buildCalDay('M', '16', isDone: true),
            _buildCalDay('T', '17', isDone: true),
            _buildCalDay('W', '18', isDone: true),
            _buildCalDay('T', '19', isDone: true),
            _buildCalDay('F', '20', isActive: true),
            _buildCalDay('S', '21'),
            _buildCalDay('S', '22'),
          ],
        )
      ],
    );
  }

  Widget _buildCalDay(String day, String date, {bool isDone = false, bool isActive = false}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: isActive ? AppTheme.primary : AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(8),
        border: isActive ? null : Border.all(color: AppTheme.borderLight),
      ),
      child: Column(
        children: [
          Text(day, style: TextStyle(color: isActive ? AppTheme.onPrimary : (isDone ? AppTheme.textMuted : AppTheme.textSecondary), fontSize: 10)),
          const SizedBox(height: 2),
          Text(date, style: TextStyle(color: isActive ? AppTheme.onPrimary : (isDone ? AppTheme.textMuted : AppTheme.textPrimary), fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              color: isActive ? AppTheme.onPrimary : (isDone ? AppTheme.secondary : AppTheme.primary),
              shape: BoxShape.circle,
            ),
          )
        ],
      ),
    );
  }

  Widget _buildAgendaFriday() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                Container(width: 10, height: 10, decoration: const BoxDecoration(color: AppTheme.primary, shape: BoxShape.circle)),
                const SizedBox(width: 8),
                const Text('Friday • Oct 20', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(color: AppTheme.primary.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(12), border: Border.all(color: AppTheme.primary.withValues(alpha: 0.3))),
                  child: const Text('Tonight', style: TextStyle(color: AppTheme.primary, fontSize: 10, fontWeight: FontWeight.bold)),
                )
              ],
            ),
            const Icon(Icons.drag_indicator, color: AppTheme.textMuted, size: 20),
          ],
        ),
        const SizedBox(height: 12),
        _buildLunchRow('Mediterranean Hummus Wrap'),
        const SizedBox(height: 12),
        _buildHeroicDinnerCard(),
      ],
    );
  }

  Widget _buildLunchRow(String title) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(color: AppTheme.surfaceContainerHigh, borderRadius: BorderRadius.circular(8), border: Border.all(color: AppTheme.borderLight)),
                child: const Icon(Icons.wb_sunny, color: AppTheme.primary, size: 18),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('LUNCH • 10M PREP', style: TextStyle(color: AppTheme.textMuted, fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 1)),
                  Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                ],
              )
            ],
          ),
          Row(
            children: [
              Container(width: 8, height: 8, decoration: const BoxDecoration(color: AppTheme.secondary, shape: BoxShape.circle)),
              const SizedBox(width: 8),
              const Icon(Icons.more_vert, color: AppTheme.textMuted, size: 20),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildHeroicDinnerCard() {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
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
                    image: NetworkImage('https://lh3.googleusercontent.com/aida-public/AB6AXuDQQA9OC66-72xuC2otKsPODx9-mRH7rbGrdtueb85fnxx5UyIW0LzGa9ML5La8eqfgRFP4VmHytyLs8Ix-cE92ZV5-k84dsBYp7voNnYgUz7_oHqHsPpM0KUHTSc6M0IEmkURBbySqPGX7RJQvJa_hl16wxM8-tJW8ddRsZfavAhiE8TBd5EaOseBNqe3qeDS_Vt67yNqLiAulc9TsF--fCwZqstwAYr5v_n2jYLDTBCdc4cUoUk0mdg'),
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
                      colors: [
                        AppTheme.surfaceContainer.withValues(alpha: 1.0),
                        AppTheme.surfaceContainer.withValues(alpha: 0.5),
                        Colors.transparent,
                      ],
                    ),
                  ),
                ),
              ),
              Positioned(
                top: 12,
                left: 12,
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppTheme.background.withValues(alpha: 0.85),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: AppTheme.borderLight),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.dinner_dining, color: AppTheme.primary, size: 14),
                          SizedBox(width: 4),
                          Text('Dinner • 35 min', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: const Color(0xFF58292B).withValues(alpha: 0.9),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: const Color(0xFF782F2F).withValues(alpha: 0.4)),
                      ),
                      child: const Text('4 Servings', style: TextStyle(color: Color(0xFFFFDAD8), fontSize: 10, fontWeight: FontWeight.bold)),
                    )
                  ],
                ),
              ),
              Positioned(
                top: 12,
                right: 12,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppTheme.background.withValues(alpha: 0.85),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: AppTheme.borderLight),
                  ),
                  child: Row(
                    children: [
                      const Text('Cook:', style: TextStyle(color: AppTheme.textMuted, fontSize: 10)),
                      const SizedBox(width: 6),
                      Container(
                        width: 20,
                        height: 20,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: AppTheme.primary.withValues(alpha: 0.4)),
                          image: const DecorationImage(
                            image: NetworkImage('https://lh3.googleusercontent.com/aida/AEtjO1Uh3WZdQR4WF5TfVywgL8pgqd3TXDmpZFRzzaGd1JL_j8m6WRbW6w7F_Rl4KCKTapXDi6_6PAMK69gOeUGFO8rESpK2S2AVwvcaw2fcyxLVe92ZP4j-MtybWmceMIBZ6vcg2Ku-eEkvedsVjno7CA2oM5OnEYycP11YHnxCL7H_xjnKmR1ljY3DWl-wj-BArJAvrrpAtLIGPbEHijOLxHS9DdPwYpRYbSE7g_dlbnXEsiUYdVchQt2VOYiY'),
                            fit: BoxFit.cover,
                          ),
                        ),
                      )
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
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Quinoa & Charred Veggies', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                          SizedBox(height: 2),
                          Text('Tossed in smoked paprika oil, whipped goat curd, and thyme', style: TextStyle(color: AppTheme.textMuted, fontSize: 13), overflow: TextOverflow.ellipsis),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      width: 24,
                      height: 24,
                      decoration: BoxDecoration(
                        color: AppTheme.surfaceContainerHigh,
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(color: AppTheme.borderLight),
                      ),
                      child: const Icon(Icons.check, color: AppTheme.textMuted, size: 16),
                    )
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    _buildPillTag('Quinoa'),
                    _buildPillTag('Squash'),
                    _buildPillTag('Red Onion'),
                    _buildPillTag('Pecan'),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: const Color(0xFF3D1C24),
                        borderRadius: BorderRadius.circular(4),
                        border: Border.all(color: const Color(0xFF58292B)),
                      ),
                      child: const Text('+3 pantry items', style: TextStyle(color: AppTheme.secondaryContainer, fontSize: 10, fontWeight: FontWeight.bold)),
                    )
                  ],
                ),
                const SizedBox(height: 16),
                const Divider(height: 1),
                const SizedBox(height: 16),
                const Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.local_fire_department, color: AppTheme.primary, size: 16),
                        SizedBox(width: 6),
                        Text('540 kcal / bowl', style: TextStyle(color: AppTheme.textMuted, fontSize: 12, fontWeight: FontWeight.bold)),
                      ],
                    ),
                    Row(
                      children: [
                        Text('View Recipe Steps', style: TextStyle(color: AppTheme.primary, fontSize: 12, fontWeight: FontWeight.bold)),
                        SizedBox(width: 4),
                        Icon(Icons.arrow_forward, color: AppTheme.primary, size: 14),
                      ],
                    )
                  ],
                )
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildPillTag(String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Text(label, style: const TextStyle(fontSize: 10)),
    );
  }

  Widget _buildAgendaSaturday() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                Container(width: 10, height: 10, decoration: const BoxDecoration(color: AppTheme.secondary, shape: BoxShape.circle)),
                const SizedBox(width: 8),
                const Text('Saturday • Oct 21', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(color: AppTheme.surfaceContainerHigh, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppTheme.borderLight)),
                  child: const Text('Tomorrow', style: TextStyle(color: AppTheme.textMuted, fontSize: 10, fontWeight: FontWeight.bold)),
                )
              ],
            ),
            const Icon(Icons.add, color: AppTheme.textMuted, size: 20),
          ],
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppTheme.surfaceContainer,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppTheme.borderLight),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    width: 32,
                    height: 32,
                    decoration: BoxDecoration(color: AppTheme.surfaceContainerHigh, borderRadius: BorderRadius.circular(8), border: Border.all(color: AppTheme.borderLight)),
                    child: const Icon(Icons.brunch_dining, color: AppTheme.secondary, size: 18),
                  ),
                  const SizedBox(width: 12),
                  const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('LUNCH • QUICK PREP', style: TextStyle(color: AppTheme.textMuted, fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 1)),
                      Text('Avocado Sourdough Toast & Poached Egg', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                    ],
                  )
                ],
              ),
              Container(width: 8, height: 8, decoration: const BoxDecoration(color: AppTheme.secondary, shape: BoxShape.circle)),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppTheme.surfaceContainer,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppTheme.borderLight),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Text('DINNER • 45M', style: TextStyle(color: AppTheme.secondary, fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 1)),
                          const SizedBox(width: 8),
                          Container(width: 4, height: 4, decoration: const BoxDecoration(color: AppTheme.textMuted, shape: BoxShape.circle)),
                          const SizedBox(width: 8),
                          const Text('Batch Cooking', style: TextStyle(color: AppTheme.textMuted, fontSize: 10)),
                        ],
                      ),
                      const SizedBox(height: 2),
                      const Text('Sizzling Charred Pepper Fajitas', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 2),
                      const Text('With cumin black beans, lime cilantro basmati rice & pico', style: TextStyle(color: AppTheme.textMuted, fontSize: 13)),
                    ],
                  ),
                  Container(
                    width: 32,
                    height: 32,
                    decoration: BoxDecoration(color: AppTheme.surfaceContainerHigh, shape: BoxShape.circle, border: Border.all(color: AppTheme.borderLight)),
                    child: const Icon(Icons.restaurant, color: AppTheme.textMuted, size: 18),
                  )
                ],
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFF93000A).withValues(alpha: 0.3),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFFFFB4AB).withValues(alpha: 0.3)),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.priority_high, color: Color(0xFFFFB4AB), size: 12),
                            SizedBox(width: 4),
                            Text('2 Limes needed', style: TextStyle(color: Color(0xFFFFB4AB), fontSize: 10, fontWeight: FontWeight.bold)),
                          ],
                        ),
                      ),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppTheme.surfaceContainerHigh,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppTheme.borderLight),
                        ),
                        child: const Text('6 Portions', style: TextStyle(color: AppTheme.textMuted, fontSize: 10)),
                      )
                    ],
                  ),
                  const Text("Mia's Turn to Cook", style: TextStyle(color: AppTheme.primary, fontSize: 10, fontWeight: FontWeight.bold)),
                ],
              )
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildAgendaSunday() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                Container(width: 10, height: 10, decoration: const BoxDecoration(color: Color(0xFFFA9793), shape: BoxShape.circle)),
                const SizedBox(width: 8),
                const Text('Sunday • Oct 22', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(color: const Color(0xFF58292B).withValues(alpha: 0.4), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF782F2F).withValues(alpha: 0.5))),
                  child: const Text('Family Dinner', style: TextStyle(color: Color(0xFFFFBDBA), fontSize: 10, fontWeight: FontWeight.bold)),
                )
              ],
            ),
            const Icon(Icons.add, color: AppTheme.textMuted, size: 20),
          ],
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppTheme.surfaceContainer,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppTheme.borderLight),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('HEARTH SPECIAL • 50M', style: TextStyle(color: AppTheme.primary, fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 1)),
                      SizedBox(height: 2),
                      Text('Paneer Gravy, Jeera Rice & Chapati', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                      SizedBox(height: 2),
                      Text('Creamy cashew tomato base with freshly rolled warm flatbreads', style: TextStyle(color: AppTheme.textMuted, fontSize: 13)),
                    ],
                  ),
                  Container(
                    width: 24,
                    height: 24,
                    decoration: BoxDecoration(color: AppTheme.surfaceContainerHigh, borderRadius: BorderRadius.circular(6), border: Border.all(color: AppTheme.borderLight)),
                    child: const Icon(Icons.bookmark_border, color: AppTheme.textMuted, size: 15),
                  )
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  SizedBox(
                    width: 44,
                    height: 24,
                    child: Stack(
                      children: [
                        Positioned(
                          left: 0,
                          child: Container(
                            width: 24,
                            height: 24,
                            decoration: BoxDecoration(
                              color: AppTheme.primary,
                              shape: BoxShape.circle,
                              border: Border.all(color: AppTheme.surfaceContainer),
                            ),
                            child: const Center(child: Text('Y', style: TextStyle(color: AppTheme.onPrimary, fontSize: 10, fontWeight: FontWeight.bold))),
                          ),
                        ),
                        Positioned(
                          left: 18,
                          child: Container(
                            width: 24,
                            height: 24,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(color: AppTheme.surfaceContainer),
                              image: const DecorationImage(
                                image: NetworkImage('https://lh3.googleusercontent.com/aida/AEtjO1Uh3WZdQR4WF5TfVywgL8pgqd3TXDmpZFRzzaGd1JL_j8m6WRbW6w7F_Rl4KCKTapXDi6_6PAMK69gOeUGFO8rESpK2S2AVwvcaw2fcyxLVe92ZP4j-MtybWmceMIBZ6vcg2Ku-eEkvedsVjno7CA2oM5OnEYycP11YHnxCL7H_xjnKmR1ljY3DWl-wj-BArJAvrrpAtLIGPbEHijOLxHS9DdPwYpRYbSE7g_dlbnXEsiUYdVchQt2VOYiY'),
                                fit: BoxFit.cover,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Text('Co-op Cook: Shared household meal', style: TextStyle(color: AppTheme.textMuted, fontSize: 10)),
                ],
              )
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildPastItemsDrawer() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.background,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Icon(Icons.expand_more, color: AppTheme.textMuted, size: 18),
              SizedBox(width: 8),
              Text('12 checked off meals this week', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
            ],
          ),
          Text('Mon — Thu', style: TextStyle(color: AppTheme.secondary, fontSize: 10, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildStickyActionBar() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.background.withValues(alpha: 0.95),
        border: const Border(top: BorderSide(color: AppTheme.borderLight)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.6),
            blurRadius: 24,
            offset: const Offset(0, -8),
          )
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('3 meals scheduled', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
              SizedBox(height: 2),
              Text('14 items needed in grocery', style: TextStyle(color: AppTheme.secondary, fontSize: 10)),
            ],
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: AppTheme.primary,
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Row(
              children: [
                Text('Review Groceries', style: TextStyle(color: AppTheme.onPrimary, fontWeight: FontWeight.bold, fontSize: 12)),
                SizedBox(width: 6),
                Icon(Icons.arrow_forward, color: AppTheme.onPrimary, size: 16),
              ],
            ),
          )
        ],
      ),
    );
  }
}
